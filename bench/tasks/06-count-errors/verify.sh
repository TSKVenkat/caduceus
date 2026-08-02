want=$(grep -c "ERROR" log.txt)
got=$(cat count.txt 2>/dev/null | tr -d '[:space:]')
[ "$got" = "$want" ]
