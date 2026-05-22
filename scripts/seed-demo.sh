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

# Santa Clara / South Bay
post_special "Saffron Garden" "Santa Clara, CA" "indian" \
  "Paneer Butter Masala" \
  "Tonight: hand-cubed paneer in tomato-cashew gravy with kasuri methi, finished with cream and a swirl of butter. Served with garlic naan."

post_special "Sattvik" "Santa Clara, CA" "indian" \
  "Chana Masala" \
  "Tonight: slow-cooked chickpeas in a smoky tomato-onion masala, kissed with kasuri methi. Served with butter naan and a side of pickled onions."

post_special "Verdure" "San Francisco, CA" "italian" \
  "Tagliolini al Limone" \
  "Tonight: hand-cut egg tagliolini, Meyer lemon butter, parmigiano, and a single basil leaf. Light and bright."

post_special "Burma Love" "San Francisco, CA" "fusion" \
  "Tea Leaf Salad" \
  "Tonight: tossed-tableside tea leaf salad with toasted lentils, peanuts, sesame, jalapeño, garlic and tomato. Crunch and umami in every bite."

post_special "Vina Enoteca" "Palo Alto, CA" "italian" \
  "Cacio e Pepe" \
  "Tonight: house tonnarelli, pecorino romano, freshly cracked Tellicherry pepper. Three ingredients, infinite restraint."

echo ""
echo "Seeded. Run \`curl $BASE_URL/api/specials\` to verify."
