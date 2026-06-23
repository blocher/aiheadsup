# Bundled deck format

Any `*.toml` file in this directory becomes a built-in deck the next time the app starts. Put its optional cover image in [`public/covers`](../../public/covers), and use the same filename in `photo_file_name`.

Required fields are `id`, `name`, `category`, and `cards`. Cards must be simple, one-to-four-word prompts. Set `spoiler_mode = true` for a Harry Potter deck and give every card a `first_revealed_book` from 1 through 8, where 8 is *Harry Potter and the Cursed Child*.

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

cards = [
  { text = "Harry Potter", first_revealed_book = 1 },
  { text = "Golden Snitch", first_revealed_book = 1 },
]
```

Increment `revision` whenever you change a deck's cards. The app reconciles a built-in deck in place, preserving usage on prompts that still match. Bundled TOML decks replace old bundled revisions; locally imported TOML and in-app AI decks remain untouched.

To move an AI deck to another device, export it from the pack detail screen or export all AI decks from the library. This creates a ZIP containing `deck.toml` and its cover. On the web it downloads; on iOS and Android it opens the system share sheet for AirDrop, Files, Messages, or an Android share target. Import the ZIP from the library on the receiving device.
