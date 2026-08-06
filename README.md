# 付箋ホワイトボード

付箋を自由に貼り、矢印で結び、画像も置けるローカル完結のホワイトボードです。  
ボードデータは mmmindmap と同様に、ローカルサービスのワークスペースフォルダへ恒久保存されます。

## 使い方（推奨）

```bash
npm install
npm start
```

ブラウザで `http://127.0.0.1:43172/` が開きます（ポートが埋まっていれば近傍の空きポート）。

### 開発時（HMR）

ターミナルを2つ使います。

```bash
npm run dev:service   # Fastify API（--dev で Vite Origin を許可）
npm run dev           # Vite UI（/api を 43172 へプロキシ）
```

## ワークスペース

既定の保存先はリポジトリ直下の `workspace/` です。

```text
workspace/
  <boardId>/
    board.json
    assets/<imageId>
  .fusen/
    config.json
    runtime.json
    trash/<boardId>/
```

別フォルダを使う場合:

```bash
npm start -- --workspace D:\boards\fusen --port 43172
```

## 操作

- **付箋追加**: ツールバー、またはキャンバス空白をダブルクリック
- **編集**: 付箋をダブルクリック
- **色**: 付箋を選択して色スウォッチ
- **矢印**: 付箋のハンドルからドラッグ
- **画像**: Ctrl+V またはドロップ
- **ボード**: タイトル編集、ボード一覧（作成・切替・ゴミ箱復元）
- **Undo / Redo**: `Ctrl+Z` / `Ctrl+Y`（Mac は `Cmd`）
- **削除**: `Delete` / `Backspace`（ボード削除はゴミ箱へ）
- **保存**: 自動でワークスペースへ保存。JSON の書き出し / 読み込み（新規ボードとして）も可

初回起動時、ブラウザの `localStorage` に旧データがあれば 1 ボードとして移行します。

## 技術

Vite + React + TypeScript + `@xyflow/react` + Zustand + Fastify（ローカル API）。
