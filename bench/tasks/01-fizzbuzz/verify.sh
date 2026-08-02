out=$(node fizzbuzz.js 2>/dev/null) || exit 1
[ "$(echo "$out" | sed -n '1p')" = "1" ] || exit 1
[ "$(echo "$out" | sed -n '3p')" = "Fizz" ] || exit 1
[ "$(echo "$out" | sed -n '5p')" = "Buzz" ] || exit 1
[ "$(echo "$out" | sed -n '15p')" = "FizzBuzz" ] || exit 1
exit 0
