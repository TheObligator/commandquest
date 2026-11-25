# Use later

A player can put an activated ability off to a step: crack a fetch land in the end step before their
turn, cycle a card in an opponent's end step, use something every upkeep. Server:
`forge-web-server/.../engine/UseLater.java`, used by `WebPlayerController`. Client:
`web/src/game/later.ts`, `LaterMenu.tsx`. Protocol: `later` in [game-protocol.md](game-protocol.md).

## Setting it

Right-click your card: each activated ability that isn't a mana or loyalty ability is listed under
**Use later**. Choose when:

- **End step before my turn**: the end step of whoever's turn it is when yours is next. It's worked out
  then, so it's right when someone leaves the game or takes an extra turn.
- **My next upkeep**, or the **next end step** of anyone.
- **Pick a step**: click it on the phase strip, on your turn, any opponent's, or (with "Per opponent")
  one player's.

An ability that only works at sorcery speed can only be put off to your own main phases. Then:

- **Use it for me** (the default) or **Just stop and ask me**.
- **Every turn, not just once**, and **Every copy I have** (both off by default).
- **Save with this deck**, for every copy. Not for one particular player's turn.

What's waiting is in your left rail, and marked on the ability in its menu. Nobody else sees it.

## When the step comes

As you're about to get priority there with an empty stack, the game uses the ability for you: you need
no stop there, and auto-passing doesn't skip it (not even "My turn, ignore stack"). Its costs are paid
without asking, except life that would leave you under 5 (`WebPlayerController.KEEP_LIFE`). You still
choose targets, pay mana and search your library yourself. Then you pass on it once, as after using
it by hand without holding priority. Backing out (no target, say) stops you there.

- If it can't be used then (no target, no mana), a once-only one is dropped, and you're stopped there
  and told.
- "Just stop and ask me" stops you there, ending any auto-pass. Passing leaves it.
- If the end step before your turn never comes (someone ended the turn), you're asked at your next
  priority, on your turn.
- Set during the very step it's for, it waits for the next one.

## Losing the card first

When the top of the stack targets the card with removal (or bounces, taps, steals or changes it), or
is a mass effect that would take it (Armageddon), you're stopped once, so you can use it in response.
Effects that make you choose what to sacrifice aren't noticed.

## Auto-pay

Auto-pay taps a waiting card last, and tries to leave the mana for what's waiting, like for the spells
in your hand.

## Rewinding

Rewinding doesn't bring back something that was used once: put it off again.
