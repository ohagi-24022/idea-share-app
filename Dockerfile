# Node.jsの軽量な環境を使用
FROM node:20-alpine

# アプリケーションの作業ディレクトリを設定
WORKDIR /app

# パッケージ情報を先にコピーしてインストール
COPY package*.json ./
RUN npm install

# 残りのすべてのファイルをコピー
COPY . .

# Fly.io側にポート3000を使うことを伝える
EXPOSE 3000

# サーバーを起動するコマンド
CMD ["node", "server.js"]