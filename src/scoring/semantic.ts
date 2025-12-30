import Anthropic from '@anthropic-ai/sdk';
import { SemanticEvaluation } from '../types/index.js';
import { logger } from '../utils/logger.js';

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required for semantic evaluation');
    }
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

const EVALUATION_PROMPT = `あなたはAI分野の投稿を評価する専門家です。
以下の投稿を5つの観点から0-100のスコアで評価してください。

評価観点:
1. technicalNovelty（技術的新規性）: 新しい技術情報や発見が含まれているか
2. practicalValue（実務価値）: 実際の業務や開発に役立つか
3. topicality（話題性）: 現在のトレンドや注目度が高いか
4. archiveValue（保存価値）: 後で参照する価値があるか
5. discussionPotential（議論性）: 議論を呼ぶ可能性があるか

投稿内容:
"""
{content}
"""

JSON形式で回答してください:
{
  "technicalNovelty": <0-100>,
  "practicalValue": <0-100>,
  "topicality": <0-100>,
  "archiveValue": <0-100>,
  "discussionPotential": <0-100>
}`;

/**
 * LLMで投稿のセマンティックスコアを評価
 */
export async function evaluateSemantic(content: string): Promise<number> {
  try {
    const client = getAnthropicClient();

    const response = await client.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: EVALUATION_PROMPT.replace('{content}', content),
        },
      ],
    });

    const responseText = response.content[0].type === 'text'
      ? response.content[0].text
      : '';

    // JSONを抽出
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('Failed to parse semantic evaluation response');
      return 50; // デフォルト値
    }

    const evaluation: SemanticEvaluation = JSON.parse(jsonMatch[0]);

    // 5つのスコアの平均を計算
    const averageScore =
      (evaluation.technicalNovelty +
        evaluation.practicalValue +
        evaluation.topicality +
        evaluation.archiveValue +
        evaluation.discussionPotential) /
      5;

    return Math.round(averageScore);
  } catch (error) {
    logger.error('Semantic evaluation failed:', error);
    return 50; // エラー時はデフォルト値
  }
}

/**
 * バッチでセマンティック評価（レート制限対策）
 */
export async function evaluateSemanticBatch(
  contents: string[],
  delayMs = 500
): Promise<number[]> {
  const scores: number[] = [];

  for (const content of contents) {
    const score = await evaluateSemantic(content);
    scores.push(score);

    // レート制限対策
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return scores;
}
