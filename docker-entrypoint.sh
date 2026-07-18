#!/bin/sh
set -e

db_tries=1
until node -e "const net=require('net'); const url=new URL(process.env.DATABASE_URL); const socket=net.connect({host:url.hostname,port:Number(url.port||5432)},()=>{socket.end();process.exit(0)}); socket.setTimeout(1000,()=>{socket.destroy();process.exit(1)}); socket.on('error',()=>process.exit(1));"; do
  if [ "$db_tries" -ge 30 ]; then
    echo "database port was not ready after retries"
    exit 1
  fi
  echo "database port not ready, waiting ($db_tries/30)"
  db_tries=$((db_tries + 1))
  sleep 2
done

tries=1
until node node_modules/prisma/build/index.js migrate deploy; do
  if [ "$tries" -ge 30 ]; then
    echo "migration deploy failed after retries"
    exit 1
  fi
  echo "database not ready, retrying migration ($tries/30)"
  tries=$((tries + 1))
  sleep 2
done

node prisma/seed.cjs
exec node .next/standalone/server.js
