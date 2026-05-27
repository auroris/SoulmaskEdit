[**wsedit**](../README.md)

***

[wsedit](../README.md) / IDENTITY\_PATH\_BY\_KIND

# Variable: IDENTITY\_PATH\_BY\_KIND

> `const` **IDENTITY\_PATH\_BY\_KIND**: `Readonly`\<\{ `player`: `"ZhuRenGuid"`; \}\>

Defined in: relations.mjs:59

Identity-property convention by classified row kind. Default is
'SelfUid' — most rows put their identity at that path. Players are
special: `ZhuRenGuid` on an HPlayerState row carries the player's OWN
identity, but the same property name on an NPC row is a *reference* to
its owning player. Distinguishing the two is the only reason we need a
kindLookup here.

Add entries when more identity-path conventions are discovered (guild
rows, system rows, etc.).
