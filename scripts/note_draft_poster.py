#!/usr/bin/env python3
"""
note自動下書き投稿スクリプト
- Markdown本文（＋任意のサムネ画像）をnoteに「下書き」として自動保存
- 認証はSeleniumでログインしてCookieを取得、requestsでAPIを叩く
- 安全設計：公開はしない（draft固定）、失敗時は途中停止
"""

import os
import re
import time
import json
import logging
from pathlib import Path
from typing import Optional, Tuple, Dict, Any
from functools import wraps

import requests
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.common.exceptions import TimeoutException, WebDriverException
from dotenv import load_dotenv

# =============================================================================
# 設定
# =============================================================================

load_dotenv()

# 環境変数から認証情報を取得
NOTE_EMAIL = os.getenv("NOTE_EMAIL", "")
NOTE_PASSWORD = os.getenv("NOTE_PASSWORD", "")
NOTE_USER_NAME = os.getenv("NOTE_USER_NAME", "")

# API設定
BASE_URL = "https://note.com"
API_BASE = f"{BASE_URL}/api/v1"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

# レート制限
REQUEST_INTERVAL = 2.0  # 秒
MAX_RETRIES = 3
RETRY_BACKOFF = 2.0  # 指数バックオフの基数

# =============================================================================
# ロギング設定
# =============================================================================

def setup_logging(log_file: Optional[str] = None) -> logging.Logger:
    """ロギングを設定"""
    logger = logging.getLogger("note_poster")
    logger.setLevel(logging.INFO)

    formatter = logging.Formatter(
        "[%(asctime)s] %(levelname)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )

    # コンソール出力
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    # ファイル出力（オプション）
    if log_file:
        file_handler = logging.FileHandler(log_file, encoding="utf-8")
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)

    return logger

logger = setup_logging()

# =============================================================================
# ユーティリティ
# =============================================================================

def mask_sensitive(text: str) -> str:
    """認証情報をマスクする"""
    if not text:
        return "***"
    if len(text) <= 4:
        return "***"
    return text[:2] + "***" + text[-2:]


def rate_limited_request(func):
    """レート制限デコレータ"""
    @wraps(func)
    def wrapper(*args, **kwargs):
        time.sleep(REQUEST_INTERVAL)

        last_error = None
        for attempt in range(MAX_RETRIES):
            try:
                return func(*args, **kwargs)
            except requests.exceptions.HTTPError as e:
                if e.response.status_code == 429:
                    wait_time = REQUEST_INTERVAL * (RETRY_BACKOFF ** attempt)
                    logger.warning(f"429 Too Many Requests. {wait_time}秒待機後リトライ ({attempt + 1}/{MAX_RETRIES})")
                    time.sleep(wait_time)
                    last_error = e
                else:
                    raise
            except requests.exceptions.RequestException as e:
                last_error = e
                wait_time = REQUEST_INTERVAL * (RETRY_BACKOFF ** attempt)
                logger.warning(f"リクエストエラー: {e}. {wait_time}秒待機後リトライ ({attempt + 1}/{MAX_RETRIES})")
                time.sleep(wait_time)

        if last_error:
            raise last_error
        return None

    return wrapper


# =============================================================================
# A) 認証: Seleniumでログイン→Cookie取得
# =============================================================================

def get_note_cookies(email: str, password: str, headless: bool = True) -> Dict[str, str]:
    """
    Seleniumでnoteにログインし、Cookieを取得

    Args:
        email: noteのメールアドレス
        password: noteのパスワード
        headless: ヘッドレスモードで実行するか

    Returns:
        Cookie辞書 {name: value}
    """
    logger.info(f"noteにログイン中... (email: {mask_sensitive(email)})")

    # Chrome オプション設定
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
        driver.get(f"{BASE_URL}/login")

        wait = WebDriverWait(driver, 30)

        # ページの読み込みを待機
        time.sleep(3)

        # 「メールでログイン」リンクをクリック（存在する場合）
        try:
            email_login_link = driver.find_element(By.XPATH, "//*[contains(text(), 'メールでログイン')]")
            email_login_link.click()
            logger.info("「メールでログイン」をクリック")
            time.sleep(2)
        except:
            logger.info("「メールでログイン」リンクなし、直接入力を試行")

        # メールアドレス入力（複数のセレクタを試行）
        email_selectors = [
            'input[type="email"]',
            'input[name="email"]',
            '.o-login__mailField input',
            'input[placeholder*="メール"]',
            'input[autocomplete="email"]',
        ]

        email_input = None
        for selector in email_selectors:
            try:
                # 要素が操作可能になるまで待機
                email_input = wait.until(
                    EC.element_to_be_clickable((By.CSS_SELECTOR, selector))
                )
                logger.info(f"メール入力欄を発見: {selector}")
                break
            except:
                continue

        if not email_input:
            raise Exception("メールアドレス入力欄が見つかりません")

        # 要素をスクロールして表示
        driver.execute_script("arguments[0].scrollIntoView(true);", email_input)
        time.sleep(0.5)

        email_input.clear()
        email_input.send_keys(email)

        # パスワード入力
        password_selectors = [
            'input[type="password"]',
            'input[name="password"]',
            'input[autocomplete="current-password"]',
        ]

        password_input = None
        for selector in password_selectors:
            try:
                password_input = wait.until(
                    EC.element_to_be_clickable((By.CSS_SELECTOR, selector))
                )
                logger.info(f"パスワード入力欄を発見: {selector}")
                break
            except:
                continue

        if not password_input:
            raise Exception("パスワード入力欄が見つかりません")

        # 要素をスクロールして表示
        driver.execute_script("arguments[0].scrollIntoView(true);", password_input)
        time.sleep(0.5)

        password_input.clear()
        password_input.send_keys(password)

        # ログインボタンをクリック
        button_selectors = [
            'button[type="submit"]',
            '.o-login__button',
            'button:contains("ログイン")',
            'input[type="submit"]',
        ]

        login_button = None
        for selector in button_selectors:
            try:
                login_button = wait.until(
                    EC.element_to_be_clickable((By.CSS_SELECTOR, selector))
                )
                logger.info(f"ログインボタンを発見: {selector}")
                break
            except:
                continue

        if not login_button:
            raise Exception("ログインボタンが見つかりません")

        login_button.click()

        # ログイン完了を待機（URLが変わるか、特定の要素が現れるか）
        time.sleep(5)  # ログイン処理待機

        # ログイン成功確認
        if "login" in driver.current_url.lower():
            # エラーメッセージを確認
            try:
                error_elem = driver.find_element(By.CSS_SELECTOR, ".error-message, .alert-danger")
                logger.error(f"ログイン失敗: {error_elem.text}")
            except:
                logger.error("ログイン失敗: ログインページから遷移しませんでした")
            raise Exception("ログインに失敗しました")

        # Cookieを取得
        cookies = driver.get_cookies()
        cookie_dict = {c["name"]: c["value"] for c in cookies}

        logger.info(f"ログイン成功: {len(cookie_dict)}個のCookieを取得")
        return cookie_dict

    except TimeoutException as e:
        logger.error(f"タイムアウト: ログイン画面の要素が見つかりません - {e}")
        raise
    except WebDriverException as e:
        logger.error(f"WebDriverエラー: {e}")
        raise
    finally:
        if driver:
            driver.quit()


# =============================================================================
# B) 変換: Markdown → HTML
# =============================================================================

def markdown_to_html(markdown_text: str) -> str:
    """
    MarkdownをnoteのHTML形式に変換（簡易版）

    noteの期待するHTML構造:
    - 見出し: <h2>, <h3>
    - 段落: <p>
    - リスト: <ul><li>
    - 強調: <strong>, <em>
    - コード: <code>
    """
    html_lines = []
    lines = markdown_text.split('\n')
    in_list = False
    in_code_block = False
    code_content = []

    for line in lines:
        # コードブロック
        if line.strip().startswith('```'):
            if in_code_block:
                html_lines.append(f'<pre><code>{chr(10).join(code_content)}</code></pre>')
                code_content = []
                in_code_block = False
            else:
                in_code_block = True
            continue

        if in_code_block:
            code_content.append(line)
            continue

        # 見出し
        if line.startswith('### '):
            if in_list:
                html_lines.append('</ul>')
                in_list = False
            html_lines.append(f'<h3>{line[4:].strip()}</h3>')
            continue

        if line.startswith('## '):
            if in_list:
                html_lines.append('</ul>')
                in_list = False
            html_lines.append(f'<h2>{line[3:].strip()}</h2>')
            continue

        if line.startswith('# '):
            if in_list:
                html_lines.append('</ul>')
                in_list = False
            html_lines.append(f'<h2>{line[2:].strip()}</h2>')
            continue

        # リスト
        if line.strip().startswith('- ') or line.strip().startswith('* '):
            if not in_list:
                html_lines.append('<ul>')
                in_list = True
            content = line.strip()[2:]
            content = apply_inline_formatting(content)
            html_lines.append(f'<li>{content}</li>')
            continue

        # 番号付きリスト
        if re.match(r'^\d+\. ', line.strip()):
            if not in_list:
                html_lines.append('<ul>')
                in_list = True
            content = re.sub(r'^\d+\. ', '', line.strip())
            content = apply_inline_formatting(content)
            html_lines.append(f'<li>{content}</li>')
            continue

        # 空行
        if not line.strip():
            if in_list:
                html_lines.append('</ul>')
                in_list = False
            continue

        # 通常の段落
        if in_list:
            html_lines.append('</ul>')
            in_list = False

        content = apply_inline_formatting(line)
        html_lines.append(f'<p>{content}</p>')

    # リストを閉じる
    if in_list:
        html_lines.append('</ul>')

    return '\n'.join(html_lines)


def apply_inline_formatting(text: str) -> str:
    """インライン要素の変換（太字、斜体、コード）"""
    # 太字 **text**
    text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
    # 斜体 *text*
    text = re.sub(r'\*(.+?)\*', r'<em>\1</em>', text)
    # インラインコード `code`
    text = re.sub(r'`(.+?)`', r'<code>\1</code>', text)
    # リンク [text](url)
    text = re.sub(r'\[(.+?)\]\((.+?)\)', r'<a href="\2">\1</a>', text)

    return text


# =============================================================================
# C) 投稿フロー
# =============================================================================

def get_session(cookies: Dict[str, str]) -> requests.Session:
    """認証済みセッションを作成"""
    session = requests.Session()
    session.headers.update({
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Origin": BASE_URL,
        "Referer": f"{BASE_URL}/",
    })
    for name, value in cookies.items():
        session.cookies.set(name, value)
    return session


@rate_limited_request
def create_article(
    cookies: Dict[str, str],
    title: str,
    markdown_content: str
) -> Tuple[str, str]:
    """
    記事を作成（下書きとして）

    Returns:
        (article_id, article_key)
    """
    logger.info(f"記事を作成中: {title[:30]}...")

    session = get_session(cookies)
    html_content = markdown_to_html(markdown_content)

    # noteのAPI形式に合わせる（複数のフォーマットを試行）
    payloads_to_try = [
        # フォーマット1: 標準形式
        {
            "note": {
                "name": title,
                "body": html_content,
                "status": "draft",
                "type": "TextNote",
            }
        },
        # フォーマット2: シンプル形式
        {
            "name": title,
            "body": html_content,
            "status": "draft",
        },
        # フォーマット3: text_note形式
        {
            "text_note": {
                "name": title,
                "body": html_content,
                "status": "draft",
            }
        },
    ]

    last_error = None
    for i, payload in enumerate(payloads_to_try):
        try:
            logger.info(f"APIフォーマット{i+1}を試行中...")
            response = session.post(
                f"{API_BASE}/text_notes",
                json=payload
            )

            if response.status_code in [200, 201]:
                data = response.json()
                # レスポンス形式の違いに対応
                if "data" in data:
                    data = data["data"]
                article_id = str(data.get("id", ""))
                article_key = data.get("key", "")
                logger.info(f"記事作成成功: id={article_id}, key={article_key}")
                return article_id, article_key

            logger.warning(f"フォーマット{i+1}失敗: {response.status_code}")
            last_error = response

        except Exception as e:
            logger.warning(f"フォーマット{i+1}例外: {e}")
            last_error = e

    # すべて失敗した場合
    if last_error:
        if hasattr(last_error, 'text'):
            logger.error(f"記事作成失敗: {last_error.status_code}")
            logger.error(f"レスポンス: {last_error.text[:500]}")
        raise Exception(f"記事作成に失敗しました: {last_error}")

    raise Exception("記事作成に失敗しました")


@rate_limited_request
def upload_image(
    cookies: Dict[str, str],
    image_path: str
) -> Tuple[str, str]:
    """
    画像をアップロード

    Returns:
        (image_key, image_url)
    """
    logger.info(f"画像をアップロード中: {image_path}")

    if not os.path.exists(image_path):
        raise FileNotFoundError(f"画像ファイルが見つかりません: {image_path}")

    session = get_session(cookies)
    # multipart用にContent-Typeを削除
    del session.headers["Content-Type"]

    with open(image_path, "rb") as f:
        files = {
            "image": (os.path.basename(image_path), f, "image/png")
        }
        response = session.post(
            f"{API_BASE}/upload_image",
            files=files
        )

    if response.status_code not in [200, 201]:
        logger.error(f"画像アップロード失敗: {response.status_code}")
        logger.error(f"レスポンス: {response.text[:500]}")
        response.raise_for_status()

    data = response.json()
    image_key = data.get("key", "")
    image_url = data.get("url", "")

    logger.info(f"画像アップロード成功: key={image_key}")
    return image_key, image_url


@rate_limited_request
def update_article_draft(
    cookies: Dict[str, str],
    article_id: str,
    title: str,
    markdown_content: str,
    image_key: Optional[str] = None
) -> bool:
    """
    記事を下書きとして更新（アイキャッチ設定含む）

    Args:
        cookies: 認証Cookie
        article_id: 記事ID
        title: タイトル
        markdown_content: Markdown本文
        image_key: アイキャッチ画像のキー（オプション）

    Returns:
        成功したかどうか
    """
    logger.info(f"記事を更新中: id={article_id}")

    session = get_session(cookies)
    html_content = markdown_to_html(markdown_content)

    payload = {
        "name": title,
        "body": html_content,
        "status": "draft",  # 常に下書き（安全設計）
    }

    if image_key:
        payload["eyecatch_image_key"] = image_key
        logger.info(f"アイキャッチを設定: {image_key}")

    response = session.put(
        f"{API_BASE}/text_notes/{article_id}",
        json=payload
    )

    if response.status_code not in [200, 201]:
        logger.error(f"記事更新失敗: {response.status_code}")
        logger.error(f"レスポンス: {response.text[:500]}")
        response.raise_for_status()

    logger.info("記事更新成功（下書き保存完了）")
    return True


# =============================================================================
# D) まとめ実行
# =============================================================================

def post_to_note(
    email: str,
    password: str,
    title: str,
    markdown_content: str,
    image_path: Optional[str] = None,
    headless: bool = True
) -> Optional[str]:
    """
    noteに記事を下書き投稿する（メイン関数）

    Args:
        email: noteのメールアドレス
        password: noteのパスワード
        title: 記事タイトル
        markdown_content: Markdown本文
        image_path: サムネイル画像のパス（オプション）
        headless: ヘッドレスモードで実行するか

    Returns:
        成功時は記事URL、失敗時はNone
    """
    logger.info("=" * 50)
    logger.info("note下書き投稿を開始")
    logger.info("=" * 50)

    # 1) Cookie取得
    logger.info("Step 1: ログイン・Cookie取得")
    cookies = get_note_cookies(email, password, headless)

    # 2) 記事作成
    logger.info("Step 2: 記事作成")
    article_id, article_key = create_article(cookies, title, markdown_content)

    # 3) 画像アップロード（任意）
    image_key = None
    if image_path:
        logger.info("Step 3: 画像アップロード")
        image_key, image_url = upload_image(cookies, image_path)
    else:
        logger.info("Step 3: 画像なし（スキップ）")

    # 4) 下書き保存（アイキャッチ含む）
    logger.info("Step 4: 下書き保存")
    update_article_draft(cookies, article_id, title, markdown_content, image_key)

    # 5) 完了
    username = NOTE_USER_NAME or "your_username"
    article_url = f"{BASE_URL}/{username}/n/{article_key}"

    logger.info("=" * 50)
    logger.info("下書き投稿完了！")
    logger.info(f"記事URL: {article_url}")
    logger.info("※ noteの管理画面から確認・公開してください")
    logger.info("=" * 50)

    return article_url


# =============================================================================
# E) 安全運用
# =============================================================================

def safe_post_to_note(
    email: str,
    password: str,
    title: str,
    markdown_content: str,
    image_path: Optional[str] = None,
    headless: bool = True
) -> bool:
    """
    安全ラッパー: 例外をキャッチしてログ出力、Falseで終了
    """
    try:
        result = post_to_note(email, password, title, markdown_content, image_path, headless)
        return result is not None
    except requests.exceptions.HTTPError as e:
        logger.error(f"HTTPエラー: {e.response.status_code}")
        logger.error(f"詳細: {e.response.text[:500] if e.response else 'N/A'}")
        return False
    except requests.exceptions.RequestException as e:
        logger.error(f"リクエストエラー: {e}")
        return False
    except json.JSONDecodeError as e:
        logger.error(f"JSONパースエラー: {e}")
        return False
    except FileNotFoundError as e:
        logger.error(f"ファイルが見つかりません: {e}")
        return False
    except Exception as e:
        logger.error(f"予期しないエラー: {type(e).__name__}: {e}")
        return False


# =============================================================================
# メイン実行
# =============================================================================

def main():
    """コマンドライン実行用"""
    import argparse

    parser = argparse.ArgumentParser(description="noteに記事を下書き投稿")
    parser.add_argument("--title", "-t", required=True, help="記事タイトル")
    parser.add_argument("--file", "-f", required=True, help="Markdownファイルのパス")
    parser.add_argument("--image", "-i", help="サムネイル画像のパス（オプション）")
    parser.add_argument("--no-headless", action="store_true", help="ブラウザを表示する")

    args = parser.parse_args()

    # 認証情報チェック
    if not NOTE_EMAIL or not NOTE_PASSWORD:
        logger.error("環境変数 NOTE_EMAIL, NOTE_PASSWORD を設定してください")
        logger.error("例: export NOTE_EMAIL='your@email.com'")
        return False

    # Markdownファイル読み込み
    if not os.path.exists(args.file):
        logger.error(f"Markdownファイルが見つかりません: {args.file}")
        return False

    with open(args.file, "r", encoding="utf-8") as f:
        markdown_content = f.read()

    # 実行
    success = safe_post_to_note(
        email=NOTE_EMAIL,
        password=NOTE_PASSWORD,
        title=args.title,
        markdown_content=markdown_content,
        image_path=args.image,
        headless=not args.no_headless
    )

    return success


if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
