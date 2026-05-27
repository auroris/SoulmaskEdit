[**wsedit**](../README.md)

***

[wsedit](../README.md) / COMPASS\_8

# Variable: COMPASS\_8

> `const` **COMPASS\_8**: readonly `string`[]

Defined in: transform.mjs:24

8-way compass labels indexed by yaw octant.

World-axis-to-compass convention: +X = East, +Y = North, positive yaw
rotates from +X toward +Y (counter-clockwise on the map). If a verified
actor disagrees with this orientation, flip the sign of yaw inside
`bearingFromTransform` — this array is the single source of truth.
