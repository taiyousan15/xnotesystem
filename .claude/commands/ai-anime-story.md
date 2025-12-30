# AIストーリーアニメ制作ガイド

ユーザーのAIストーリーアニメ制作をステップバイステップでサポートします。

## 制作フロー

### Step 1: キャラクター・世界観設計
**使用ツール**: ChatGPT

**決めること**:
1. **主人公**
   - 名前、年齢、性別
   - 外見（髪型、髪色、目の色、身長、服装）
   - 性格、口癖、特徴
   - 目標、動機

2. **サブキャラクター**
   - 主人公との関係性
   - 役割（味方、敵、メンター等）

3. **世界観**
   - 時代設定（現代、未来、ファンタジー等）
   - 場所（都市、田舎、異世界等）
   - ルール（魔法の有無、技術レベル等）

### Step 2: ストーリー構成
**使用ツール**: ChatGPT

**三幕構成**:
```
第一幕（起）: 日常 → 事件発生
第二幕（承）: 試練 → 成長
第三幕（転結）: クライマックス → 解決
```

**ショートアニメの場合**（1-3分）:
- 1つの明確なテーマ
- シンプルな起承転結
- インパクトのあるオチ

### Step 3: 台本（シナリオ）作成
**使用ツール**: ChatGPT

**フォーマット例**:
```
シーン1: 教室（昼）
---
[ナレーション]
静かな午後の教室。

[主人公（モノローグ）]
また、あの夢を見た...

[効果音: 鐘の音]

[友人]
おーい、起きろよ！
```

### Step 4: キャラクター画像生成
**使用ツール**: Nano-banana

**キャラクターシートのプロンプト**:
```
character reference sheet,
[キャラクター詳細: 髪色、目の色、服装等],
multiple angles (front, side, back),
multiple expressions (happy, sad, angry, surprised),
anime style, consistent design,
white background, full body
```

### Step 5: 静止画生成（シーン別）
**使用ツール**: Nano-banana, Seedream

各シーンに必要なカットを生成:
- 背景画像
- キャラクター配置
- 表情差分

**背景プロンプト例**:
```
anime background, [場所の詳細],
[時間帯: 朝/昼/夕方/夜],
[天気: 晴れ/曇り/雨],
detailed, high quality, no characters
```

### Step 6: 静止画を動画化
**使用ツール**: Kling, Vidu

**動きのプロンプト例**:
```
[キャラクター],
talking animation, lip sync,
subtle body movement,
hair swaying slightly,
4 seconds, smooth motion
```

### Step 7: 動画素材の結合
**使用ツール**: Remotion

シーン順に動画を配置、トランジションを追加。

### Step 8: セリフ音声生成
**使用ツール**: ElevenLabs

1. キャラクターごとに声を設定
2. 感情を込めた読み上げ
3. タイミング調整

**ElevenLabs設定例**:
- Stability: 0.5（感情表現のため低め）
- Clarity: 0.75
- Style: 適切なスタイルを選択

### Step 9: BGM・SE準備
**使用ツール**: Suno（BGM）、フリー素材（SE）

**BGMプロンプト例（Suno）**:
```
[Genre: Orchestral/Emotional]
[Mood: Mysterious, Building tension]
[Instrumental only]
[Duration: 2 minutes]
```

**SE素材サイト**:
- 効果音ラボ
- DOVA-SYNDROME
- フリー音楽素材 H/MIX

### Step 10: アニメ映像完成
**使用ツール**: Remotion

全素材を統合:
- 動画トラック
- 音声トラック（セリフ）
- BGMトラック
- SEトラック

### Step 11: 字幕・クレジット
**使用ツール**: Remotion

```jsx
// Remotion字幕コンポーネント例
<Sequence from={0} durationInFrames={90}>
  <Subtitle text="これは..." />
</Sequence>
```

### Step 12: 微修正・品質確認
- 音声と口パクの同期確認
- 不自然な動きの修正
- 音量バランス調整
- 全体の流れ確認

### Step 13: 公開・マーケティング
**投稿戦略**:
1. ティザー動画を先行公開
2. 本編公開
3. メイキング・解説動画

**プラットフォーム別最適化**:
| プラットフォーム | 形式 | ポイント |
|----------------|------|---------|
| YouTube | 横型 16:9 | サムネイル重要 |
| TikTok | 縦型 9:16 | 最初の1秒が勝負 |
| X | どちらも可 | 字幕必須 |

---

ユーザーが現在どのステップにいるか確認し、適切なサポートを提供してください。
