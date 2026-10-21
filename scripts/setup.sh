#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
read -r -s -p 'İlk yönetici şifresi (en az 12 karakter): ' ADMIN_PASSWORD
printf '\n'
export ADMIN_PASSWORD
node --input-type=module -e 'import {createApp} from "./server.js"; const {server,db}=createApp(); server.close(); db.close(); console.log("Kurulum tamamlandı. Kullanıcı adı: admin. Eski SQLite sürümünü başlatmak için: npm run start:sqlite");'
unset ADMIN_PASSWORD
