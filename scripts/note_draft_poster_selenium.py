#!/usr/bin/env python3
"""
note自動下書き投稿スクリプト（Selenium直接操作版）
- ブラウザを直接操作してnoteに記事を下書き保存
- APIを使わず、UI操作で確実に投稿
"""

import os
import time
import logging
from typing import Optional
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.common.exceptions import TimeoutException, WebDriverException
from dotenv import load_dotenv

# =============================================================================
# 設定
# =============================================================================

load_dotenv()

NOTE_EMAIL = os.getenv("NOTE_EMAIL", "")
NOTE_PASSWORD = os.getenv("NOTE_PASSWORD", "")
NOTE_USER_NAME = os.getenv("NOTE_USER_NAME", "")

BASE_URL = "https://note.com"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

# =============================================================================
# ロギング
# =============================================================================

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("note_poster")

def mask_sensitive(text: str) -> str:
    if not text or len(text) <= 4:
        return "***"
    return text[:2] + "***" + text[-2:]

# =============================================================================
# Markdown → プレーンテキスト変換（noteエディタ用）
# =============================================================================

def remove_non_bmp(text: str) -> str:
    """BMP外の文字（絵文字など）を除去"""
    return ''.join(c for c in text if ord(c) <= 0xFFFF)


def markdown_to_html(markdown_text: str) -> str:
    """
    MarkdownをnoteのProseMirrorエディタ用HTMLに変換
    URLは<a>タグでリンク化する
    """
    import re

    text = markdown_text

    # BMP外の文字を除去（ChromeDriverの制限対策）
    text = remove_non_bmp(text)

    # フロントマターを削除
    text = re.sub(r'^---\n.*?\n---\n', '', text, flags=re.DOTALL)

    # 見出しを変換（noteは「■」などで表現）
    text = re.sub(r'^### (.+)$', r'▼ \1', text, flags=re.MULTILINE)
    text = re.sub(r'^## (.+)$', r'■ \1', text, flags=re.MULTILINE)
    text = re.sub(r'^# (.+)$', r'◆ \1', text, flags=re.MULTILINE)

    # 太字を【】で表現
    text = re.sub(r'\*\*(.+?)\*\*', r'【\1】', text)

    # 斜体を削除
    text = re.sub(r'\*(.+?)\*', r'\1', text)

    # インラインコードを「」で表現
    text = re.sub(r'`(.+?)`', r'「\1」', text)

    # コードブロックを削除または簡略化
    text = re.sub(r'```[\s\S]*?```', '', text)

    # Markdownリンク [text](url) → <a href="url">text</a>
    text = re.sub(r'\[(.+?)\]\((https?://[^\)]+)\)', r'<a href="\2">\1</a>', text)

    # 画像プレースホルダーを削除
    text = re.sub(r'【IMAGE_\d+】.*', '', text)
    text = re.sub(r'【ここに.*?挿入】', '', text)

    # 余分な空行を削除
    text = re.sub(r'\n{3,}', '\n\n', text)

    # プレーンURLを<a>タグに変換（既に<a>タグ内にあるものは除く）
    # 先に一時的にマーカーで置換
    text_with_markers = text
    existing_links = re.findall(r'<a href="[^"]+">.*?</a>', text)
    for i, link in enumerate(existing_links):
        text_with_markers = text_with_markers.replace(link, f'__LINK_MARKER_{i}__')

    # プレーンURLをリンク化
    text_with_markers = re.sub(
        r'(https?://[^\s<>\"\'\)]+)',
        r'<a href="\1">\1</a>',
        text_with_markers
    )

    # マーカーを元に戻す
    for i, link in enumerate(existing_links):
        text_with_markers = text_with_markers.replace(f'__LINK_MARKER_{i}__', link)

    return text_with_markers.strip()

# =============================================================================
# メイン処理
# =============================================================================

def post_to_note_selenium(
    email: str,
    password: str,
    title: str,
    markdown_content: str,
    image_path: Optional[str] = None,
    headless: bool = False
) -> Optional[str]:
    """
    Seleniumでnoteに記事を下書き投稿
    """
    logger.info("=" * 50)
    logger.info("note下書き投稿（Selenium版）")
    logger.info("=" * 50)

    # Chrome設定
    options = Options()
    if headless:
        options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument(f"--user-agent={USER_AGENT}")
    options.add_argument("--window-size=1920,1080")

    driver = None
    try:
        driver = webdriver.Chrome(options=options)
        wait = WebDriverWait(driver, 60)

        # ===== Step 1: ログイン =====
        logger.info("Step 1: ログイン中...")
        driver.get(f"{BASE_URL}/login")
        time.sleep(3)

        # メール入力
        email_input = wait.until(
            EC.element_to_be_clickable((By.CSS_SELECTOR, '.o-login__mailField input, input[type="email"]'))
        )
        driver.execute_script("arguments[0].scrollIntoView(true);", email_input)
        time.sleep(0.5)
        email_input.clear()
        email_input.send_keys(email)
        logger.info(f"メール入力: {mask_sensitive(email)}")

        # パスワード入力
        password_input = wait.until(
            EC.element_to_be_clickable((By.CSS_SELECTOR, 'input[type="password"]'))
        )
        password_input.clear()
        password_input.send_keys(password)
        logger.info("パスワード入力完了")

        # ログインボタン
        login_button = wait.until(
            EC.element_to_be_clickable((By.CSS_SELECTOR, '.o-login__button, button[type="submit"]'))
        )
        login_button.click()
        logger.info("ログインボタンをクリック")

        # ログイン完了待機
        time.sleep(5)

        if "login" in driver.current_url.lower():
            logger.error("ログインに失敗しました")
            return None

        logger.info("ログイン成功！")

        # ===== Step 2: 記事作成画面へ =====
        logger.info("Step 2: 記事作成画面へ移動...")
        driver.get(f"{BASE_URL}/post")
        time.sleep(5)  # ページ読み込み待機

        logger.info(f"現在のURL: {driver.current_url}")

        # テキストノートを選択（複数のセレクタを試行）
        text_note_clicked = False
        text_note_selectors = [
            "//button[contains(text(), 'テキスト')]",
            "//a[contains(text(), 'テキスト')]",
            "//div[contains(text(), 'テキスト')]",
            "//*[contains(@class, 'text-note')]",
            "//button[contains(@class, 'post-type')]",
        ]

        for selector in text_note_selectors:
            try:
                elements = driver.find_elements(By.XPATH, selector)
                for elem in elements:
                    if elem.is_displayed() and 'テキスト' in elem.text:
                        elem.click()
                        logger.info(f"「テキスト」を選択: {selector}")
                        text_note_clicked = True
                        time.sleep(3)
                        break
                if text_note_clicked:
                    break
            except:
                continue

        if not text_note_clicked:
            # 直接エディタURLにアクセス
            logger.info("テキスト選択ボタンが見つかりません。直接エディタURLにアクセス...")
            driver.get(f"{BASE_URL}/notes/new")
            time.sleep(5)

        logger.info(f"エディタ画面のURL: {driver.current_url}")

        # ===== Step 3: タイトル入力 =====
        logger.info("Step 3: タイトル入力...")
        time.sleep(3)  # エディタ読み込み待機

        # 現在のURLを確認
        logger.info(f"現在のURL: {driver.current_url}")

        # ページのHTMLを一部取得してデバッグ
        try:
            page_source = driver.page_source[:2000]
            logger.info(f"ページソース（先頭2000文字）: {page_source[:500]}...")
        except:
            pass

        # タイトル入力欄を探す（複数のセレクタを試行）
        title_selectors = [
            # noteの新しいエディタ
            'textarea[placeholder*="タイトル"]',
            'textarea[placeholder*="記事タイトル"]',
            'input[placeholder*="タイトル"]',
            # contenteditable
            '[contenteditable="true"][data-placeholder*="タイトル"]',
            'div[data-placeholder*="タイトル"]',
            # クラスベース
            '.editor-title textarea',
            '.editor-title input',
            '.note-editor-title',
            'textarea.title',
            # 汎用
            'textarea:first-of-type',
            '.ProseMirror[data-placeholder*="タイトル"]',
        ]

        title_input = None
        for selector in title_selectors:
            try:
                elements = driver.find_elements(By.CSS_SELECTOR, selector)
                for elem in elements:
                    if elem.is_displayed():
                        title_input = elem
                        logger.info(f"タイトル入力欄を発見: {selector}")
                        break
                if title_input:
                    break
            except Exception as e:
                logger.debug(f"セレクタ {selector} 失敗: {e}")
                continue

        if not title_input:
            # XPathで試行
            xpath_selectors = [
                "//textarea[contains(@placeholder, 'タイトル')]",
                "//input[contains(@placeholder, 'タイトル')]",
                "//div[contains(@data-placeholder, 'タイトル')]",
                "//textarea",
            ]
            for xpath in xpath_selectors:
                try:
                    elements = driver.find_elements(By.XPATH, xpath)
                    for elem in elements:
                        if elem.is_displayed():
                            title_input = elem
                            logger.info(f"タイトル入力欄をXPathで発見: {xpath}")
                            break
                    if title_input:
                        break
                except:
                    continue

        if not title_input:
            logger.warning("タイトル入力欄が見つかりません。スクリーンショットを保存...")
            try:
                driver.save_screenshot("/tmp/note_debug_step3.png")
                logger.info("スクリーンショット保存: /tmp/note_debug_step3.png")
            except:
                pass

        if title_input:
            driver.execute_script("arguments[0].scrollIntoView(true);", title_input)
            time.sleep(0.5)
            title_input.click()
            time.sleep(0.3)
            title_input.clear()
            title_input.send_keys(title)
            logger.info(f"タイトル入力完了: {title[:30]}...")

        # ===== Step 4: 本文入力 =====
        logger.info("Step 4: 本文入力...")
        time.sleep(2)

        # 本文をHTML形式に変換（URLリンク化含む）
        html_content_raw = markdown_to_html(markdown_content)
        logger.info(f"変換後の本文: {len(html_content_raw)}文字")

        # 本文入力欄を探す（より多くのセレクタ）
        body_selectors = [
            '.ProseMirror',
            '[contenteditable="true"]:not([data-placeholder*="タイトル"])',
            '.editor-body [contenteditable="true"]',
            'div[data-placeholder*="本文"]',
            'div[data-placeholder*="ここに"]',
            '[contenteditable="true"]',
            'div[role="textbox"]',
        ]

        body_input = None
        for selector in body_selectors:
            try:
                elements = driver.find_elements(By.CSS_SELECTOR, selector)
                for elem in elements:
                    if elem.is_displayed():
                        # タイトル欄と区別するため、位置をチェック
                        location = elem.location
                        if location.get('y', 0) > 100:  # タイトルより下にある要素
                            body_input = elem
                            logger.info(f"本文入力欄を発見: {selector} (y={location.get('y')})")
                            break
                if body_input:
                    break
            except Exception as e:
                logger.debug(f"セレクタ {selector} 失敗: {e}")
                continue

        if not body_input:
            # すべてのcontenteditableを取得して2番目を使用
            try:
                all_editable = driver.find_elements(By.CSS_SELECTOR, '[contenteditable="true"]')
                if len(all_editable) >= 2:
                    body_input = all_editable[1]  # 2番目が本文の可能性
                    logger.info(f"本文入力欄を2番目のcontenteditableから取得")
                elif len(all_editable) == 1:
                    body_input = all_editable[0]
                    logger.info(f"本文入力欄を唯一のcontenteditableから取得")
            except:
                pass

        if not body_input:
            logger.warning("本文入力欄が見つかりません。スクリーンショットを保存...")
            try:
                driver.save_screenshot("/tmp/note_debug_step4.png")
                logger.info("スクリーンショット保存: /tmp/note_debug_step4.png")
            except:
                pass

        if body_input:
            driver.execute_script("arguments[0].scrollIntoView(true);", body_input)
            time.sleep(0.5)
            body_input.click()
            time.sleep(0.5)

            # JavaScriptで本文を入力（BMP制限を回避）
            # ProseMirrorの場合、innerHTMLを使用してリンクを保持
            try:
                # まず既存のコンテンツをクリア
                driver.execute_script("arguments[0].innerHTML = '';", body_input)
                time.sleep(0.3)

                # テキストを段落ごとに分割してHTMLとして挿入
                paragraphs = html_content_raw.split('\n\n')
                html_content = ''
                for para in paragraphs:
                    if para.strip():
                        # 改行を<br>に変換（<a>タグ内は保持）
                        para_html = para.replace('\n', '<br>')
                        html_content += f'<p>{para_html}</p>'

                # JavaScriptでコンテンツを設定
                driver.execute_script("""
                    var editor = arguments[0];
                    var content = arguments[1];
                    editor.innerHTML = content;
                    // イベントをトリガーして変更を認識させる
                    editor.dispatchEvent(new Event('input', { bubbles: true }));
                """, body_input, html_content)

                logger.info(f"本文入力完了（JavaScript）: {len(html_content_raw)}文字")
            except Exception as js_error:
                logger.warning(f"JavaScript入力失敗: {js_error}")
                logger.info("send_keysで再試行（リンクは失われます）...")

                # フォールバック: send_keysを使用（短いチャンクで）
                # HTMLタグを除去してプレーンテキストに
                import re
                plain_fallback = re.sub(r'<a href="[^"]+">([^<]+)</a>', r'\1', html_content_raw)
                plain_fallback = re.sub(r'<[^>]+>', '', plain_fallback)

                chunk_size = 300
                total_chunks = (len(plain_fallback) + chunk_size - 1) // chunk_size
                for i, start in enumerate(range(0, len(plain_fallback), chunk_size)):
                    chunk = plain_fallback[start:start+chunk_size]
                    try:
                        body_input.send_keys(chunk)
                    except Exception as e:
                        logger.warning(f"チャンク {i+1} 入力失敗: {e}")
                        continue
                    if (i + 1) % 10 == 0:
                        logger.info(f"本文入力中... {i+1}/{total_chunks} チャンク")
                    time.sleep(0.15)

                logger.info(f"本文入力完了（send_keys）: {len(plain_fallback)}文字")
        else:
            logger.error("本文入力欄が見つかりませんでした")

        # ===== Step 5: 画像アップロード（オプション） =====
        if image_path and os.path.exists(image_path):
            logger.info("Step 5: 画像アップロード...")
            try:
                # アイキャッチ設定ボタンを探す
                eyecatch_button = driver.find_element(By.XPATH, "//*[contains(text(), 'アイキャッチ')]")
                eyecatch_button.click()
                time.sleep(2)

                # ファイル入力を探す
                file_input = driver.find_element(By.CSS_SELECTOR, 'input[type="file"]')
                file_input.send_keys(os.path.abspath(image_path))
                logger.info(f"画像をアップロード: {image_path}")
                time.sleep(3)
            except Exception as e:
                logger.warning(f"画像アップロードをスキップ: {e}")
        else:
            logger.info("Step 5: 画像なし（スキップ）")

        # ===== Step 6: 公開設定 =====
        logger.info("Step 6: 公開設定...")
        time.sleep(2)

        # 「公開」または「投稿」ボタンを探す
        publish_button_selectors = [
            "//button[contains(text(), '公開')]",
            "//button[contains(text(), '投稿')]",
            "//span[contains(text(), '公開')]/ancestor::button",
            "//span[contains(text(), '投稿')]/ancestor::button",
        ]

        publish_clicked = False
        for selector in publish_button_selectors:
            try:
                elements = driver.find_elements(By.XPATH, selector)
                for elem in elements:
                    if elem.is_displayed():
                        driver.execute_script("arguments[0].scrollIntoView(true);", elem)
                        time.sleep(0.3)
                        elem.click()
                        logger.info(f"公開ボタンをクリック: {selector}")
                        publish_clicked = True
                        time.sleep(3)
                        break
                if publish_clicked:
                    break
            except Exception as e:
                logger.debug(f"公開ボタン検索失敗: {selector}: {e}")
                continue

        if not publish_clicked:
            logger.warning("公開ボタンが見つかりません。スクリーンショットを保存...")
            try:
                driver.save_screenshot("/tmp/note_debug_step6.png")
                logger.info("スクリーンショット保存: /tmp/note_debug_step6.png")
            except:
                pass

        # ===== Step 7: 有料設定（480円） =====
        if publish_clicked:
            logger.info("Step 7: 有料設定（480円）...")
            time.sleep(2)

            # 有料設定のラジオボタンまたはチェックボックスを探す
            paid_selectors = [
                "//label[contains(text(), '有料')]",
                "//span[contains(text(), '有料')]",
                "//input[@value='paid']",
                "//*[contains(text(), '販売設定')]",
                "//button[contains(text(), '有料')]",
            ]

            paid_selected = False
            for selector in paid_selectors:
                try:
                    elements = driver.find_elements(By.XPATH, selector)
                    for elem in elements:
                        if elem.is_displayed():
                            elem.click()
                            logger.info(f"有料設定を選択: {selector}")
                            paid_selected = True
                            time.sleep(2)
                            break
                    if paid_selected:
                        break
                except:
                    continue

            # 価格入力（480円）
            if paid_selected:
                try:
                    price_input_selectors = [
                        "//input[@type='number']",
                        "//input[contains(@placeholder, '価格')]",
                        "//input[contains(@placeholder, '円')]",
                        "//input[@name='price']",
                    ]
                    for selector in price_input_selectors:
                        try:
                            price_input = driver.find_element(By.XPATH, selector)
                            if price_input.is_displayed():
                                price_input.clear()
                                price_input.send_keys("480")
                                logger.info("価格を480円に設定")
                                time.sleep(1)
                                break
                        except:
                            continue
                except Exception as e:
                    logger.warning(f"価格入力失敗: {e}")

            # ===== Step 8: 有料エリア設定 =====
            logger.info("Step 8: 有料エリア設定...")
            time.sleep(2)

            # 「有料エリア設定」ボタンをクリック
            area_setting_clicked = False
            area_selectors = [
                "//button[contains(text(), '有料エリア設定')]",
                "//button[text()='有料エリア設定']",
                "//span[contains(text(), '有料エリア設定')]/ancestor::button",
            ]

            for selector in area_selectors:
                try:
                    elements = driver.find_elements(By.XPATH, selector)
                    for elem in elements:
                        if elem.is_displayed():
                            driver.execute_script("arguments[0].click();", elem)
                            logger.info(f"有料エリア設定ボタンをクリック: {selector}")
                            area_setting_clicked = True
                            time.sleep(3)
                            break
                    if area_setting_clicked:
                        break
                except Exception as e:
                    logger.debug(f"有料エリア設定ボタン検索失敗: {e}")
                    continue

            if not area_setting_clicked:
                logger.warning("有料エリア設定ボタンが見つかりません")
                try:
                    driver.save_screenshot("/tmp/note_debug_step8_area.png")
                except:
                    pass

            # ===== Step 9: 有料ラインの設定 → 確定 =====
            if area_setting_clicked:
                logger.info("Step 9: 有料ライン設定 → 確定...")
                time.sleep(3)

                # スクリーンショット
                try:
                    driver.save_screenshot("/tmp/note_step9_paywall.png")
                    logger.info("有料ライン設定画面: /tmp/note_step9_paywall.png")
                except:
                    pass

                # 確定/完了ボタンを探す
                confirm_selectors = [
                    "//button[contains(text(), '確定')]",
                    "//button[contains(text(), '設定完了')]",
                    "//button[contains(text(), '完了')]",
                    "//button[contains(text(), 'OK')]",
                    "//span[contains(text(), '確定')]/parent::button",
                    "//span[contains(text(), '完了')]/parent::button",
                ]

                confirmed = False
                for selector in confirm_selectors:
                    try:
                        elements = driver.find_elements(By.XPATH, selector)
                        for elem in elements:
                            if elem.is_displayed():
                                driver.execute_script("arguments[0].click();", elem)
                                logger.info(f"有料ライン確定ボタンをクリック: {selector}")
                                confirmed = True
                                time.sleep(3)
                                break
                        if confirmed:
                            break
                    except:
                        continue

                if not confirmed:
                    logger.info("確定ボタンが見つかりません。ページ状態を確認...")
                    try:
                        driver.save_screenshot("/tmp/note_step9_no_confirm.png")
                    except:
                        pass

            # ===== Step 10: 最終公開 =====
            logger.info("Step 10: 最終公開...")
            time.sleep(2)

            # スクリーンショット（公開画面）
            try:
                driver.save_screenshot("/tmp/note_step10_before.png")
                logger.info("Step 10開始時: /tmp/note_step10_before.png")
            except:
                pass

            # 全てのボタンを確認
            try:
                all_buttons = driver.find_elements(By.TAG_NAME, "button")
                logger.info(f"ページ上のボタン数: {len(all_buttons)}")
                for i, btn in enumerate(all_buttons[:10]):
                    try:
                        btn_text = btn.text.strip()[:30] if btn.text else "(no text)"
                        is_visible = btn.is_displayed()
                        logger.info(f"  ボタン{i}: '{btn_text}' | visible={is_visible}")
                    except:
                        pass
            except:
                pass

            # 公開するボタンを探す
            final_publish_selectors = [
                "//button[text()='公開する']",
                "//button[text()='投稿する']",
                "//button[normalize-space()='公開する']",
                "//button[normalize-space()='投稿する']",
                "//span[text()='公開する']/parent::button",
                "//button[contains(text(), '公開する')]",
                "//button[contains(text(), '投稿する')]",
                "//button[contains(text(), '有料で公開')]",
                "//button[contains(text(), '公開')]",
                "//button[contains(@class, 'primary')]//span[contains(text(), '公開')]/..",
                "//button[contains(@class, 'submit')]",
            ]

            published = False
            for selector in final_publish_selectors:
                try:
                    elements = driver.find_elements(By.XPATH, selector)
                    for elem in elements:
                        if elem.is_displayed():
                            # 要素までスクロール
                            driver.execute_script("arguments[0].scrollIntoView(true);", elem)
                            time.sleep(0.5)
                            # JavaScriptでクリック（より確実）
                            driver.execute_script("arguments[0].click();", elem)
                            logger.info(f"最終公開ボタンをクリック: {selector}")
                            published = True
                            time.sleep(5)
                            break
                    if published:
                        break
                except Exception as e:
                    logger.debug(f"公開ボタン検索失敗: {selector}: {e}")
                    continue

            # CSSセレクタでも試行
            if not published:
                css_selectors = [
                    'button[type="submit"]',
                    'button.primary',
                    'button[class*="publish"]',
                    'form button:last-child',
                ]
                for selector in css_selectors:
                    try:
                        elements = driver.find_elements(By.CSS_SELECTOR, selector)
                        for elem in elements:
                            if elem.is_displayed():
                                driver.execute_script("arguments[0].scrollIntoView(true);", elem)
                                time.sleep(0.3)
                                driver.execute_script("arguments[0].click();", elem)
                                logger.info(f"最終公開ボタンをクリック（CSS）: {selector}")
                                published = True
                                time.sleep(5)
                                break
                        if published:
                            break
                    except:
                        continue

            if not published:
                logger.warning("最終公開ボタンが見つかりません。スクリーンショットを保存...")
                try:
                    driver.save_screenshot("/tmp/note_debug_step8.png")
                    logger.info("スクリーンショット保存: /tmp/note_debug_step8.png")
                except:
                    pass
                logger.info("手動で公開してください。30秒間待機します...")
                time.sleep(30)

        # 完了
        current_url = driver.current_url
        logger.info("=" * 50)
        logger.info("有料記事公開処理完了！")
        logger.info(f"現在のURL: {current_url}")
        logger.info("noteの管理画面で確認してください")
        logger.info("=" * 50)

        return current_url

    except TimeoutException as e:
        logger.error(f"タイムアウト: {e}")
        return None
    except WebDriverException as e:
        logger.error(f"WebDriverエラー: {e}")
        return None
    except Exception as e:
        logger.error(f"予期しないエラー: {type(e).__name__}: {e}")
        return None
    finally:
        if driver:
            if not headless:
                try:
                    # 対話モードの場合のみ入力を待つ
                    import sys
                    if sys.stdin.isatty():
                        input("Enterキーで終了（ブラウザを確認してください）...")
                    else:
                        # バックグラウンド実行時は10秒待機してから終了
                        logger.info("10秒後にブラウザを終了します...")
                        time.sleep(10)
                except EOFError:
                    logger.info("EOFError - バックグラウンド実行。10秒後に終了...")
                    time.sleep(10)
            driver.quit()


def main():
    import argparse

    parser = argparse.ArgumentParser(description="noteに記事を下書き投稿（Selenium版）")
    parser.add_argument("--title", "-t", required=True, help="記事タイトル")
    parser.add_argument("--file", "-f", required=True, help="Markdownファイルのパス")
    parser.add_argument("--image", "-i", help="サムネイル画像のパス")
    parser.add_argument("--headless", action="store_true", help="ヘッドレスモード")

    args = parser.parse_args()

    if not NOTE_EMAIL or not NOTE_PASSWORD:
        logger.error("環境変数 NOTE_EMAIL, NOTE_PASSWORD を設定してください")
        return False

    if not os.path.exists(args.file):
        logger.error(f"ファイルが見つかりません: {args.file}")
        return False

    with open(args.file, "r", encoding="utf-8") as f:
        content = f.read()

    result = post_to_note_selenium(
        email=NOTE_EMAIL,
        password=NOTE_PASSWORD,
        title=args.title,
        markdown_content=content,
        image_path=args.image,
        headless=args.headless
    )

    return result is not None


if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
