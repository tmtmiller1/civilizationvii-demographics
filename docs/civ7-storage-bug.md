# The Civilization VII mod-storage bug, and what "Repair mod storage" does about it

This page explains the game bug behind the red notice box on the Hall of Fame, what the Repair mod storage button does,
what it deletes, and what Firaxis needs to change so that none of this is necessary.

## The bug, in one paragraph

Civilization VII gives UI mods a small key-value store (`localStorage`, kept in `LocalStorage.sqlite` in your game
data folder). Writing to it works. Reading from it does not: whatever key a mod asks for, the game returns the value
of the first key in the store, sorted by name. Every mod gets the same answer, and it is only the right answer for
the one mod whose key happens to sort first. The store cannot be listed either (`localStorage.key(i)` is always null),
so a mod cannot even see what is in there. This is in the game, not in any mod, and it is present in 1.5.0.

## What that does to mods

Most mods with an options panel keep their settings in one shared entry called `modSettings`, one section per mod.
Under the bug, every one of those mods asks for `modSettings`, is handed the first-sorting entry instead, bolts its own
section onto that, and writes the result back. So:

- The shared entry only ever holds the *last* mod that saved, on top of a copy of some other mod's data, and none of
  them can read it back. Their settings return to defaults every launch.
- The one mod whose own entry sorts first is the only one that works. Everyone else is reading its data.
- Demographics keeps its settings in that shared entry. Its Hall of Fame (the list of past games) lives in a file of
  its own, `demographics-halloffame.sqlite` in the game's user folder, which the bug doesn't reach. Up to 2.10.0 the
  list was in the shared entry too, and it still goes there when the file can't be used (no save yet to find the
  folder from, or a file that can't be opened or written). In that case Demographics refuses to write when what it
  reads back isn't the shared entry, because writing would copy a stranger's data into it, so the Hall of Fame can't
  read or save its list, and a notice box on the Hall of Fame pages says so. Every game is still stored in its own
  save.

## What the repair does

Deleting, unlike reading, works correctly. **Repair mod storage** empties the store and writes the shared entry back
with Demographics' settings in it, and its past games too when they aren't in their own file (the file isn't
touched). The shared entry is then the first (and only) key, so every read
returns it, which is the right answer for every mod that keeps its settings there. Other mods add their own sections
back to it the next time they save a setting. From then on, settings persist and the Hall of Fame's list of past games
is saved.

Nothing is reserved for Demographics. It restarts the shared entry; it does not own it. After the repair and a cold
relaunch on 2026-09-22, a third-party options panel read back every setting stored in the shared entry.

A mod that keeps a separate entry of its own (its own key, not `modSettings`) is not helped: it could not read that
entry before and still cannot, because the game still returns the first key, which is now the shared entry. If such a
mod writes a key that sorts ahead of `modSettings`, the bug bites everyone again and the repair is offered again.

## What the repair deletes

Everything that is not the shared entry is deleted, permanently. Because the store cannot be listed, the repair cannot
back anything up first or delete selectively. What that means:

- Exactly one mod loses data it was using: the one whose entry sorted first, which is the only data the game was
  reading correctly. If that mod keeps its own game history or notes there, they are gone.
- What other mods had written to the store is cleared too, but they could never read it back, so it was already lost
  to them. After the repair they start saving properly.
- Your saved games, the history Demographics keeps inside each save, the game's own options, and every mod's files are
  not touched. The store is only used by mods, and only for settings-sized data.

The repair is offered only while the notice box is showing, or while a note under the Hall of Fame says Demographics'
settings aren't being saved; clicking the box or the button under the note opens a sheet that explains the bug and the
button, and the button takes two clicks with a Cancel. It can be run again: if a mod later writes its own
first-sorting key, the bug bites again, the notice comes back, and so does the button.

## What Firaxis needs to fix

The game's storage handler already contains the right query (`SELECT "value" ... WHERE "id" = ? AND "key" = ?`) next
to the wrong one it appears to use (`... ORDER BY "key" LIMIT 1 OFFSET ?`, at offset 0). Routing `getItem(key)` to the
keyed query, and implementing `key(i)` with a query that selects `"key"`, would fix reads and listing at once, and
this repair would never be needed. A reproduction with a one-file mod, log lines and the resulting database is written
up and ready for the 2K/Firaxis support portal. Until it is fixed, the repair is the only thing a mod can offer.

## How to tell if you are affected

Open the Hall of Fame (from the main menu or under World Rankings). A red notice box saying a Civilization VII bug is
blocking the Hall of Fame means the game is returning another mod's entry and the Hall of Fame's own file couldn't be
used. A note saying settings changed this session couldn't be saved means the shared entry is blocked while the Hall of
Fame reads fine from its file. Settings from other mods that never stick between launches are the same bug seen from
the other side.
