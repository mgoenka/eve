#!/usr/bin/env bash
set -e

BASE_URL="${BASE_URL:-https://eve-yvqz7mfutq-uw.a.run.app}"

echo "Seeding Eve dining index at $BASE_URL ..."

post_special() {
  local name="$1"
  local city="$2"
  local cuisine="$3"
  local dish="$4"
  local caption="$5"
  curl -s -X POST "$BASE_URL/api/post-special" \
    -H 'Content-Type: application/json' \
    -d "{\"restaurantName\":\"$name\",\"city\":\"$city\",\"cuisine\":\"$cuisine\",\"dishName\":\"$dish\",\"caption\":\"$caption\"}" \
    > /dev/null
  echo "  ✓ $name — $dish"
}

# Real Bay Area restaurants (Mountain View / Santa Clara / Palo Alto / Sunnyvale)
post_special "Sattvik" "Sunnyvale, CA" "indian" \
  "Paneer Butter Masala" \
  "Tonight: hand-cubed paneer in tomato-cashew gravy with kasuri methi, finished with cream and a swirl of butter."

post_special "Chaat Bhavan" "Mountain View, CA" "indian" \
  "Pani Puri" \
  "Tonight: crisp puris ready, mint-tamarind water poured to order, the pop on your tongue is the whole point."

post_special "Cucina Venti" "Mountain View, CA" "italian" \
  "Lasagna alla Bolognese" \
  "Tonight: slow-cooked Bolognese, layered with bechamel and house-rolled sheets. Served when it stops bubbling."

post_special "Vina Enoteca" "Palo Alto, CA" "italian" \
  "Tagliolini al Limone" \
  "Tonight: hand-cut egg tagliolini, Meyer lemon butter, parmigiano, basil leaf. Light and bright."

post_special "Curry Up Now" "Palo Alto, CA" "fusion" \
  "Tikka Masala Burrito" \
  "Tonight: paneer or chicken tikka masala wrapped with basmati and naan. Street-food twist of the week."

echo ""
echo "Seeded. Run 'curl $BASE_URL/api/specials' to verify."
