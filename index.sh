while true; do
  npm run index && npm run sats && node export_db.js && git add . && git commit -a -m "Update db" && git push
  sleep 600
done
