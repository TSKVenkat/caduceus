want=$(sha256sum secret.txt | awk '{print $1}')
got=$(cat result.txt 2>/dev/null | tr -d '[:space:]')
[ "$got" = "$want" ]
