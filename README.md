# Idea Shelf

URLベースで編集・閲覧できる、Express + SQLite構成のアイデア共有ボードです。

## ローカル起動

```powershell
npm.cmd install
npm.cmd start
```

ブラウザで `http://localhost:3000` を開きます。

PowerShellで `npm` の実行ポリシーエラーが出る環境では、拡張子付きの
`npm.cmd` を使用してください。

## データ保存

ローカルではプロジェクト直下の `ideashelf.db` に保存されます。
Fly.ioでは `fly.toml` の設定により `/data/ideashelf.db` を使用します。

## ヘルスチェック

```text
GET /api/health
```

正常時は `{"ok":true}` が返ります。
