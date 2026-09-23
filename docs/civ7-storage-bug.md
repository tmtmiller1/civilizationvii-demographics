# The Civilization VII mod-storage bug, and what "Repair mod storage" does about it

This page explains the game bug behind the red notice box on the Hall of Fame, what the Repair mod storage button does,
what it deletes, and what Firaxis needs to change so that none of this is necessary.

## The bug, in one paragraph

Civilization VII gives UI mods a small key-value store (`localStorage`, kept in `LocalStorage.sqlite` in your game
data folder). Writing to it works. Reading from it does not: **whatever key a mod asks for, the game returns the value
of the first key in the store, sorted by name.** Every mod gets the same answer, and it is only the right answer for
the one mod whose key happens to sort first. The store cannot be listed either (`localStorage.key(i)` is always null),
so a mod cannot even see what is in there. This is in the game, not in any mod, and it is present in 1.5.0.

## What that does to mods

Most mods with an options panel keep their settings in one shared entry called `modSettings`, one section per mod.
Under the bug, every one of those mods asks for `modSettings`, is handed the first-sorting entry instead, bolts its own
section onto that, and writes the result back. So:

- The shared entry only ever holds the *last* mod that saved, on top of a copy of some other mod's data, and none of
  them can read it back. Their settings return to defaults every launch.
- The one mod whose own entry sorts first is the only one that works. Everyone else is reading its data.
- Demographics keeps its Hall of Fame (the list of past games) in that shared entry. It refuses to write when what it
  reads back is not the shared entry, because writing would copy a stranger's data into it. So the Hall of Fame cannot
  read or save its list of past games, and a notice box on every Hall of Fame page says so. Every game is still stored in its own save.

## What the repair does

Deleting, unlike reading, works correctly. **Repair mod storage** empties the store and writes the shared entry back
with Demographics' settings and past games in it. The shared entry is then the first (and only) key, so every read
returns it, which is the right answer for every mod that keeps its settings there. Other mods add their own sections
back to it the next time they save a setting. From then on, settings persist and the Hall of Fame's list of past games is saved.

Nothing is reserved for Demographics. It restarts the shared entry; it does not own it. Watched on 2026-09-22: after the
repair and a cold relaunch, a third-party options panel read back every setting stored in the shared entry.

A mod that keeps a **separate entry of its own** (its own key, not `modSettings`) is not helped: it could not read that
entry before and still cannot, because the game still returns the first key, which is now the shared entry. If such a
mod writes a key that sorts ahead of `modSettings`, the bug bites everyone again and the repair is offered again.

## What the repair deletes

Everything that is not the shared entry is deleted, permanently. Because the store cannot be listed, the repair cannot
back anything up first or delete selectively. Be clear about what that means:

- **Exactly one mod loses data it was using**: the one whose entry sorted first, which is the only data the game was
  reading correctly. If that mod keeps its own game history or notes there, they are gone.
- What other mods had written to the store is cleared too, but they could never read it back, so it was already lost
  to them. After the repair they start saving properly.
- Your saved games, the history Demographics keeps inside each save, the game's own options, and every mod's files are
  not touched. The store is only used by mods, and only for settings-sized data.

The repair is offered only while the notice box is showing; clicking the box opens a sheet that explains the bug and
the button, and the button takes two clicks with a Cancel. It can be run again: if a mod later writes its own
first-sorting key, the bug bites again, the notice comes back, and so does the button.

## What Firaxis needs to fix

The game's storage handler already contains the right query (`SELECT "value" ... WHERE "id" = ? AND "key" = ?`) next
to the wrong one it appears to use (`... ORDER BY "key" LIMIT 1 OFFSET ?`, at offset 0). Routing `getItem(key)` to the
keyed query, and implementing `key(i)` with a query that selects `"key"`, would fix reads and listing at once, and
this repair would never be needed. A reproduction with a one-file mod, log lines and the resulting database is written
up and ready for the 2K/Firaxis support portal. Until it is fixed, the repair is the only thing a mod can offer.

## How to tell if you are affected

Open the Hall of Fame (from the main menu or under World Rankings). A red notice box saying a Civilization VII bug is
blocking the Hall of Fame means the game is returning another mod's entry. A grey note saying games are saved on this
computer means the store reads correctly. Settings from
other mods that never stick between launches are the same bug seen from the other side.
