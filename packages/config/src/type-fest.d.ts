// eslint-import-context, which the import plugin depends on, imports `KebabCase` and
// `LiteralUnion` from type-fest in its declarations without declaring type-fest as a dependency, so
// a type check of this package's source, which imports the plugin, finds no such module. These two
// names stand in for it here, in this package's own type checks alone, and never ship.
declare module 'type-fest' {
    export type KebabCase<Value> = Value extends string ? string : Value;
    export type LiteralUnion<Literal, Base> = Literal | (Base & Record<never, never>);
}
