# Bundled deck format

Any `*.toml` file in this directory becomes a built-in deck the next time the app starts. Put its optional cover image in [`public/covers`](../../public/covers), and use the same filename in `photo_file_name`.

Required fields are `id`, `name`, `category`, and `cards`. Cards must be simple, one-to-four-word prompts. For spoiler-protected decks, set `spoiler_mode = true`, choose a `spoiler_series`, and give every card a `first_revealed_installment`. Supported series are `harry_potter` (1–8), `indiana_jones` (1–5), `star_wars` (1–13), `jurassic_park` (1–7, release order), `lord_of_the_rings` (1–4: Hobbit then Fellowship, Two Towers, Return of the King), and `a_series_of_unfortunate_events` (1–13, book order). Star Wars uses release order: Episodes IV–VI, I–III, VII, *Rogue One*, VIII, *Solo*, IX, *The Mandalorian*, then general lore. Legacy Harry Potter `first_revealed_book` fields remain supported when importing older deck packages.

```toml
id = "wizarding-basics"
revision = 1
name = "Wizarding Basics"
category = "Harry Potter"
audience = "Family"
difficulty = "Easy"
special_prompt_note = "Use recognizable people, places, objects, or spells."
photo_file_name = "wizarding-basics.png"
spoiler_mode = true
spoiler_series = "harry_potter"

cards = [
  { text = "Harry Potter", first_revealed_installment = 1 },
  { text = "Golden Snitch", first_revealed_installment = 1 },
]
```

Increment `revision` whenever you change a deck's cards. The app reconciles a built-in deck in place, preserving usage on prompts that still match. Bundled TOML decks replace old bundled revisions; locally imported TOML and in-app AI decks remain untouched.

To move an AI deck to another device, export it from the pack detail screen or export all AI decks from the library. This creates a ZIP containing `deck.toml` and its cover. On the web it downloads; on iOS and Android it opens the system share sheet for AirDrop, Files, Messages, or an Android share target. Import the ZIP from the library on the receiving device.
