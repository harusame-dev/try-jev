#!/usr/bin/env node
import {
  APIError,
  AuthenticationError,
  choice,
  noul,
  RateLimitError,
  score,
  TypeSafeClient,
  TypeSafeError,
} from "@typesafe-ai/sdk";

async function readInput() {
  const arg = process.argv.slice(2).join(" ").trim();
  if (arg) return arg;
  if (process.stdin.isTTY) return "";
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data.trim();
}

async function main() {
  const text = await readInput();
  if (!text) {
    console.error('使い方: node triage.js "問い合わせ本文"  または  echo "..." | node triage.js');
    process.exitCode = 2;
    return;
  }

  try {
    const client = new TypeSafeClient();
    // 質問はすべて同じ state に対して並列評価されるため、1 リクエストにまとめた方が速くて安い
    const { answers, model, usage } = await client.systemOne({
      state: { message: text },
      questions: {
        urgent: noul("至急の対応が必要な問い合わせか？"),
        category: choice("この問い合わせの種類は？", {
          billing: "請求・支払い・返金",
          bug: "不具合・エラー報告",
          feature: "機能要望",
          other: null,
        }),
        // score の criteria は配列で、インデックスがそのままスコア値 (0 始まり) になる
        mood: score("送り主の感情は？", ["激怒", "不満", "普通", "満足", "大満足"]),
      },
    });

    const pct = (n) => `${(n * 100).toFixed(1)}%`;
    console.log(`緊急度   : ${pct(answers.urgent.noul)}${answers.urgent.noul >= 0.5 ? "  ⚠️ 至急" : ""}`);
    console.log(`カテゴリ : ${answers.category.choice} (confidence ${pct(answers.category.confidence)})`);
    for (const [label, p] of Object.entries(answers.category.probabilities)) {
      console.log(`           - ${label.padEnd(8)} ${pct(p)}`);
    }
    const nearest = answers.mood.legend[Math.round(answers.mood.score)];
    console.log(`感情     : ${answers.mood.score.toFixed(2)} / 4 (≒ ${nearest})`);
    console.log(`\nmodel=${model} input_tokens=${usage.input_tokens} output_tokens=${usage.output_tokens}`);
  } catch (error) {
    if (error instanceof RateLimitError) {
      console.error(`レート制限中です。${error.retryAfterMs ?? "?"}ms 後に再試行してください`);
    } else if (error instanceof AuthenticationError) {
      console.error("API キーが無効です。TYPESAFE_API_KEY を確認してください");
    } else if (error instanceof APIError) {
      console.error(`API エラー: status=${error.status} requestId=${error.requestId}`);
    } else if (error instanceof TypeSafeError) {
      console.error(`SDK エラー: ${error.message}`);
    } else {
      throw error;
    }
    process.exitCode = 1;
  }
}

await main();
