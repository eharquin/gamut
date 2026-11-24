# GAMUT Expression Language

**Status:** Draft for review
**Date:** 2026-07-30
**Initial scope:** VGA core
**Refines:** LANG-001 through LANG-009
**Amended:** 2026-11-12, section 7: a coordinate tuple is resolved by the
active algebra (#180); the language version does not change (section 15).
2026-11-24, sections 8, 10, 13 and 15: language version 2 writes the
operations on a value as functions, `norm(A)` instead of `A.norm`, and adds
`normalize` and `inormalize` (#342)
**License:** MIT

## 1. Purpose and authority

This document specifies the normative source language required by the initial
VGA core. Examples from MultiVector Studio are behavioral references only;
where Studio differs from this document, this document takes precedence.

A document stores source text and `languageVersion`. Tokens and abstract syntax
trees are derived data, are rebuilt on load and dimension changes, and are not
serialized as authoritative document content.

### Current implementation subset

The application currently implements one declaration or anonymous expression
per row, case-sensitive identifier references, forward-reference resolution,
and document-level diagnostics for missing names, duplicate declarations,
cycles, and invalid dependencies. It supports these features for the current
VGA(2) scalar, vector-constructor, compact-blade, unary-sign, addition,
subtraction, geometric product, outer product, inner product, regressive
product, reverse, dual, grade involution, pseudoscalar, grade-projection, and
coefficient-extraction subset. Coordinate tuples are implemented for every
algebra that declares a tuple constructor (section 7): VGA(2) and PGA(2). The read-only `V.position` and
`V.head` item-part references resolve the separately evaluated position and the derived
sum `V.position + V` for named positioned vectors. Pure bivectors receive the
same separate position capability through `B.position` but have no `head`
property. The expression panel classifies exact VGA(2) values as scalars,
vectors, bivectors, rotors, or mixed multivectors without adding those labels
to the mathematical value.

The implemented collection subset includes list literals, two- and three-term
integer ranges, zero-based indexing, value/list and singleton/equal-length
list broadcasting, distributive supported operations, stable derived element
identities, and deterministic generated-value and work limits. Nested lists
and partial list results are rejected. Positioned vector and bivector elements
retain positions through supported list operations without a list-level
position field; `position` and vector `head` distribute over compatible lists.

The functions of section 10 are implemented, including `atan2`, `norm`,
`normalize`, and, in PGA(2), `inorm` and `inormalize`, through one registry
of common-language functions.
Annotations are implemented as notes: a quotation mark typed first in an
expression row makes the row an annotation, and an expression that
becomes an annotation loses its position source, normalization, and control
in the same undoable edit. Their text renders the Markdown subset of section
3. The left contraction `<<`, the property descriptors of section 13, and
the generalized algebra-symbol and capability registries in this
specification remain planned. This section records implementation evidence; it
does not narrow the normative language.

## 2. Semantic values

Every numeric language value is a multivector, including scalars and zero. This
semantic rule does not require dense storage: implementations may use optimized
zero, scalar, sparse, or dense representations behind one owned multivector
abstraction.

When an interaction rewrites an authoritative numeric literal, it uses the
shortest decimal representation that round-trips to the same finite binary64
value. Presentation precision never shortens rewritten source. Negative zero is
written as `0`.

Lists are first-class ordered collections of multivectors. Nested lists are not
supported in the initial language scope.

Operations such as list indexing, range generation, slider configuration, and
animation that require a real or integer number accept only a pure grade-zero
multivector and extract its scalar coefficient at that boundary.

A value is a scalar exactly when every non-scalar coefficient is zero according
to exact owned-value semantics. Display tolerances do not make a multivector
scalar. A scalar boundary additionally validates finiteness and, where required,
integrality before the operation begins; it never rounds or truncates.

## 3. Items, names, and annotations

Each item contains at most one declaration, expression, or annotation.

```text
a = 1
V = vector(a)
V + e1
```

A fourth row may be a note, such as `A visible annotation`: an annotation is
a kind of item, not a syntax, so its source carries no marker.

Names match `[A-Za-z_][A-Za-z0-9_]*`, are case-sensitive, and shall be unique
within a document. Reserved language names and symbols registered by the active
algebra definition—including named constants, basis vectors, and blade
aliases—cannot be redefined. An unnamed expression is evaluated and may be
visualized but cannot be referenced by another expression.

Item identity is independent of its visible name. Renaming an item does not
rename its references in the initial scope.

An annotation is an item whose stored kind is `annotation`. It has no value
and no dependencies. Its whole source is annotation text, not expression
syntax, and may contain any valid Unicode text, including `#` and `"`
characters, accented characters, symbols, and emoji, subject only to the
common source-length and document-validity limits. For example, `était sympa`
is a valid annotation. Inline trailing comments are not supported.

The kind of an item is stored and never derived from its source. In the
interface, a quotation mark `"` typed or pasted as the first character of an
expression row makes the row an annotation; the quotation mark is a trigger
and is not stored. `"` has no other meaning in the language. In the same way,
a slash `/` typed or pasted as the first character of an expression row turns
the row into a folder (DOC-013), and Backspace at the start of the name of an
empty folder turns it back into a row; no expression starts with a division. Backspace before
the first character of an annotation makes it an expression again, with its
source unchanged. Each conversion is one undoable step. Editing the source of
an item never changes its kind: an annotation may start with `#`, and an
expression that starts with `#` is an expression with a syntax diagnostic.

#### Annotation text

Annotation text, without the whitespace around it, is
displayed in a restricted Markdown subset. Annotation text is untrusted, since
shared documents and scene links display text written by someone else, so an
implementation builds interface elements from it and never parses or injects
HTML.

- **Emphasis.** `**text**` is bold and `*text*` italic. A run of `*` opens
  emphasis only after the start of the text, whitespace, or a punctuation
  character, and before a non-whitespace character; it closes only after a
  non-whitespace character, and before whitespace, a punctuation character,
  or the end of the text. Here whitespace is a character matched by the
  ECMAScript `\s` class (Unicode `White_Space` characters and U+FEFF), and a
  punctuation character is any Unicode punctuation (`P*`) or symbol (`S*`)
  character, so `+`, `=`, `^`, and `|` count. Each closer pairs with the
  nearest unmatched opener before it; two-star runs on both sides make bold,
  otherwise italic, and unpaired stars stay literal. Emphasis nests at most 32
  levels deep; further openers stay literal. `_` is never a delimiter. So
  `a*b*c`, `2*3`, `2 * 3`, `A**2`, `x_1 and y_1`, and `_text_` stay
  literal.
- **Inline code.** A run of backticks opens a code span closed by the next
  run of the same length; its content is literal, without escapes or
  emphasis. An unclosed run is literal.
- **Links.** `[text](destination)` is a link when the destination is allowed.
  The destination has no whitespace, is at most 2,048 characters long, and
  ends at the first `)` that closes no `(` inside it, so balanced parentheses
  such as `…/Clifford_algebra_(math)` belong to it. It is allowed when it
  starts with `http://`, `https://`, or `mailto:`, case-insensitively,
  contains no control, format (such as bidirectional overrides and zero-width
  spaces), or separator character and no backslash, and parses as a WHATWG URL
  whose scheme is `http` or `https` with a host and no user name or password,
  or `mailto` with a non-empty address. The link follows the parsed URL, which
  is also the destination shown in its tooltip and accessible description, so
  the text cannot hide where it leads. Link text may contain emphasis and code
  but no link. A link with any other destination, including `javascript:`,
  `data:`, `file:`, protocol-relative and relative URLs, is displayed as the
  plain source text that wrote it. `http` and `https` links open in a new
  browsing context; every link has `rel="noopener noreferrer"`.
- **Escapes.** A backslash before `*`, `` ` ``, `[`, `]`, or `\` makes that
  character literal; before any other character the backslash is literal.
- **Mathematics.** `$…$` is inline mathematics written in TeX and `$$…$$`
  display mathematics, typeset when the annotation is displayed. An opening
  `$` is followed by a character that is not whitespace; the closing `$` is
  the next `$` without a backslash before it, and it closes only when it
  follows a character that is not whitespace and is not followed by a digit,
  so `It costs $5 and $10` is text. `\$` is a literal
  dollar. Nothing between the delimiters is read as Markdown. From a line
  that starts with `$$` to the line that holds the closing `$$`, the lines
  are not read as other blocks, so a line of TeX may start with `-`, `>`, or
  `#`. Mathematics that cannot be typeset shows the error in place, and
  mathematics over the limits of the
  [limits and interaction constants](limits-and-constants.md#23-annotation-mathematics)
  shows as its TeX source. TeX commands that would create links, load
  images, or set attributes are not available.
- **Blocks.** Annotation text is a sequence of blocks, separated by blank
  lines or by the start of another block; the inline rules above apply to the
  text of each block except code blocks.
  - *Heading:* one to three `#` followed by a space, then text; a closing run
    of `#` after a space is dropped. `#tag`, `####`, and a `#` without text
    are paragraph text. The three levels are below the headings of the
    interface.
  - *Paragraph:* consecutive lines; their line breaks are kept.
  - *List:* lines starting with `-`, `*`, or `+` and a space, or with up to
    nine digits, `.` or `)`, and a space. A numbered list starts at its first
    number. An item indented by two spaces or more belongs to a nested list
    of the item above, one level deep; another indented line continues its
    item. A blank line ends the list. A numbered list interrupts a paragraph
    only when it starts at 1, so that `2026. was…` on a second line stays
    text.
  - *Quote:* consecutive lines starting with `>`; their text holds blocks,
    nested at most eight deep.
  - *Code block:* the lines between a fence of three or more backticks or
    tildes and the next fence of the same character at least as long, or the
    end of the text. They are displayed as written, in a fixed-width font; any
    text after the opening fence is ignored.
  - *Rule:* a line of three or more `-`, `*`, or `_`, optionally separated by
    spaces.
  A backslash also makes literal the characters that start a block: `#`, `>`,
  `-`, `+`, `~`, and the `.` or `)` of a list number.
- **Everything else is text.** Raw HTML, character references, images
  (`![alt](url)` is displayed as written), tables, and other
  Markdown constructs are displayed as text.

An annotation may span several lines; an expression is one line, and an
annotation that becomes an expression has each line break replaced by a
space. In the interface, an annotation shows its source while it is edited
and only its rendered text otherwise: clicking the rendered text, or
focusing the row, edits it. While it is edited, Enter adds a line, Ctrl or
Cmd with Enter adds the next row, and Escape shows the rendered text again
without moving focus; Enter then edits again. The up and down arrows move to
the neighbouring row only from the first and the last position of the text.

An annotation row exposes its text without delimiters to assistive
technology, its editor keeps its accessible name and its place in the Tab
order while the rendered text shows, and its links are reachable with Tab in
reading order.

## 4. Numeric literals and implicit multiplication

The language accepts decimal literals and scientific notation with an explicit
exponent sign:

```text
0        42       3.14       .5       5.
1e-3     2.5E+4
```

The unary signs `+` and `-` are operators, not parts of a literal. `NaN`,
infinities, hexadecimal and binary literals, and numeric `_` separators are not
supported. A literal shall evaluate to a finite IEEE 754 number. Negative zero
evaluates as scalar zero, while stored source preserves the spelling entered by
the user. When an explicit source-rewrite command emits a numeric literal, it
emits `0` rather than `-0`.

An unsigned `e` suffix is not scientific notation because it denotes implicit
multiplication by a basis blade:

```text
5e1   == 5 * e1
5e12  == 5 * e12
5e+1  == 50
5e-1  == 0.5
```

Implicit multiplication is allowed between a number and a following blade,
constant, identifier, or parenthesized expression, including `2pi` and
`3(a+b)`. It is not allowed between two numbers or between two identifiers.

## 5. Constants

`pi` and `tau` are predefined finite grade-zero language constants. The common
language defines their names and values independently of the active algebra.

All algebraic constants and basis symbols are provided by the active algebra
definition. Examples include `e1` in VGA, `e0` in PGA and CGA, and `einf` in CGA.
The common parser resolves these registered symbols without assigning them
algebra-independent values.

`ps` is the reserved source name requested from the active algebra's registered
pseudoscalar capability. The language defines only the name and capability
lookup; the active algebra definition owns its value, basis orientation,
configuration support, and convention version. If the active algebra does not
advertise a pseudoscalar, using `ps` produces a capability diagnostic. `ps` does
not imply that the pseudoscalar is normalized or invertible.

Language constants and registered algebra symbols cannot be redefined by
document declarations. Algebra-specific constants, basis symbols, and aliases
are not hard-coded in the common parser.

## 6. Basis blades and grades

`e` names the scalar blade. All non-scalar basis symbols and their values are
registered by the active algebra definition. A registered symbol such as `e0`,
`e1`, or `einf` is resolved as one token before ordinary identifier lookup.

The initial compact blade syntax supports definition-registered, single-digit
generator indices `0` through `9`. A compact blade may use only generators for
which the active definition advertises compact source syntax. A syntactically
valid blade using an unavailable generator is an error.

Compact blade names concatenate single-digit generator indices:

```text
e12  == e1 * e2
e139 == e1 * e3 * e9
```

Non-numeric generator aliases such as `einf` are complete registered symbols;
they are not segments in compact concatenated blades and shall be combined
explicitly with an operator. Multi-digit generator indices are not supported by
the current language. The
character sequence `e{` is lexically reserved through the matching `}` for a
future explicit blade syntax. It always produces the dedicated
`LANG_RESERVED_BLADE_SYNTAX` diagnostic and shall not be tokenized as an
identifier followed by another construct. Reserving it does not commit a later
version to accepting it.

Permuted blade names are valid and carry the sign of their permutation:

```text
e21 == -e12
```

Repeated generator indices such as `e11` are errors rather than implicit zero.
Source preserves the spelling entered by the user, while display and canonical
multivector serialization use canonical increasing index order.

Coefficient extraction returns a grade-zero multivector. A valid but absent
coefficient returns zero:

```text
A = 4 + 7e1
A.e  == 4
A.e1 == 7
```

Grade projection returns a multivector and is defined for every non-negative
integer grade. A grade absent from the active algebra returns zero:

```text
G = 1 + e1 + 7e2 + 8e12
G.g0 == 1
G.g1 == e1 + 7e2
G.g2 == 8e12
```

Thus `A.g2` in VGA 1D is zero, while `A.e12` is an error because `e12` is not an
available blade in that configuration. Coefficient extraction and grade
projection distribute over lists.

## 7. Vectors and tuples

A coordinate tuple is a parenthesized list of two or more comma-separated
components, or one component followed by a comma: `(1)` is a parenthesized
scalar, and the trailing comma makes `(1,)` a one-component tuple. Only a
one-component tuple takes a trailing comma, and an empty tuple is invalid.
A component may be any expression, as a constructor argument may: the
constructor the tuple denotes rejects a non-scalar component at evaluation
with its own scalar-boundary diagnostic, and a list component broadcasts
with the rules of section 11, so `([0, 1], 2)` is the list of the two
values. The same holds for the components of `vector(…)`.

The tuple is algebra-neutral syntax. The active algebra definition declares
which registered constructor a tuple denotes and which numbers of components
it accepts; the tuple then evaluates exactly as that constructor called with
its components. A tuple has as many components as the dimension of the space,
plus the weight for a projective point:

```text
VGA(2):  (x, y)    == vector(x, y)
PGA(2):  (x, y)    == point(x, y)
         (x, y, w) == point(x, y, w)
```

In PGA(2), `(x, y, 0)` is therefore the ideal point in direction `(x, y)`;
a triple is never a line, which keeps `line(a, b, c)`. A tuple with a number of
components the active algebra does not accept, such as `(1,)` or `(1, 2, 3)`
in VGA(2) and `(1, 2, 3, 4)` in PGA(2), produces an arity diagnostic at the
tuple's span; the diagnostic names the tuple, never the constructor it would
denote. An algebra that declares no tuple constructor rejects every tuple.
One-component, three-component, and longer VGA tuples, with the zero-filled
missing and inactive excess components of VEC-002 and VEC-003, belong to a
higher-dimensional VGA and are fixed by the VGA Core milestone (VGAC-004).

`vector` is the constructor registered by the VGA definition. Every other
constructor is a registered function of the active definition and uses the
ordinary call syntax with one or more comma-separated scalar arguments; the
PGA definition registers `point(x, y)`, `point(x, y, w)`, `ipoint(x, y)`, and
`line(a, b, c)` as specified by the
[PGA convention](pga-conventions.md#9-constructors). A constructor the active
algebra does not register produces the common unsupported-function diagnostic
at the call's span, and a call with an unregistered number of arguments an
arity diagnostic. Constructor calls broadcast over list arguments with the
rules of section 11, and so do tuples.

Tuple versus constructor spelling and all component source spans remain
available to language-aware editing services; source rewriting behavior is
defined by the common design requirements.

## 8. Operators

The initial language provides:

| Syntax                | Operation                                      |
| --------------------- | ---------------------------------------------- |
| `A + B`, `A - B`      | addition and subtraction                       |
| `A * B`               | geometric product                              |
| `A / B`               | `A * inverse(B)` when the inverse exists       |
| `a % m`               | Euclidean scalar modulo for positive `m`       |
| `A ^ B`               | outer product                                  |
| `A & B`               | regressive product when defined                |
| `A \| B`              | inner product defined by the active convention |
| `A << B`              | left contraction                               |
| `R >>> A`             | sandwich action                                |
| `-A`, `+A`            | unary sign                                     |
| `~A`                  | reverse                                        |
| `!A`                  | dual when defined                              |
| `A**n`                | geometric integer power                        |
| `A.e1`                | blade coefficient                              |
| `A.g1`                | grade projection                               |
| `L[i]`, `L[I]`        | scalar and gather list indexing                |

The other operations on a value are functions of section 10: `reverse(A)`,
`dual(A)`, `involution(A)`, `inverse(A)`, `norm(A)` and the others. `~A` and
`!A` are the same as `reverse(A)` and `dual(A)`.

`A**0` is scalar one and `A**-1` is the inverse. A multivector exponent shall be
a finite integer scalar. The Studio-only `A^-1` spelling and the `§` commutator
operator are not part of the initial language.

Modulo is a common language operation, not an algebra-specific capability. Both
operands shall be finite pure grade-zero values and the modulus shall be
strictly positive. For `a % m`, the result is the grade-zero value of the active
algebra defined by `a - m * floor(a / m)`, so `10 % 2 == 0`, `10 % 4 == 2`,
and `-1 % 5 == 4`. A zero or negative modulus and a non-scalar operand produce
a structured domain diagnostic. Modulo follows the binary list-broadcasting
rules of section 11.

Unsupported or undefined operations produce structured diagnostics and never a
silent `null` or approximate substitute.

Language version 1 also wrote these operations as postfix properties,
`A.reverse`, `A.dual`, `A.involution`, `A.inverse`, `A.norm` and `A.inorm`.
Version 2 removes them (section 15); abbreviations such as `rev` and `invo`
are not aliases.

## 9. Precedence and associativity

From strongest to weakest, precedence is:

1. primaries, function calls, indexing, and property postfixes;
2. power `**`;
3. unary `!`, `~`, `-`, and `+`;
4. `^`, `&`, `|`, and `<<`;
5. `*`, `/`, and `%`;
6. `>>>`;
7. `+` and `-`.

Power is right-associative. Other binary operators are left-associative within
their level. Consequently:

```text
A * B ^ C   == A * (B ^ C)
R >>> A + B == (R >>> A) + B
```

Parentheses may always make grouping explicit.

## 10. Built-in functions and norms

The common language provides, in every algebra, the scalar functions `abs`,
`sqrt`, `exp`, `log`, `sin`, `cos`, `tan`, `sinh`, `cosh`, `tanh`, `asin`,
`acos`, `atan`, `atan2`, `min`, and `max`, the list reduction `sum`, and the operations on a value
`norm`, `normalize`, `inorm`, `inormalize`, `dual`, `inverse`, `reverse`, and
`involution`. Scalar-only functions require pure grade-zero arguments unless
an algebra capability explicitly defines their multivector extension. In
particular, an algebra may expose a multivector exponential through `exp`.
These names are reserved in every algebra, whether or not the active algebra
provides the function: they cannot be declared, and a call with the wrong
number of arguments is a syntax diagnostic. A call to one the active algebra
does not provide, such as `inorm` in VGA(2), is an unsupported-function
diagnostic.

Every function is called as `name(arguments)`; a function is never written
as a property. The common-language functions above are resolved first, and
their arity is checked when the source is parsed. Any other call resolves
against the constructors and functions the active algebra registers (such as
`vector`, `point`, `ipoint` and `line`), whose arity is checked at evaluation
(`LANG_ARITY`). An algebra-registered name belongs to its algebra, so a source
that uses it is an unsupported-function diagnostic after a switch to an
algebra without it.

The operations on a value distribute over a list and keep the identity of
each element, like the unary operators. `reverse(A)` and `dual(A)` are `~A`
and `!A` of section 8; `involution(A)` is the grade involution, which negates
the odd grades; and `inverse(A)` is the inverse, `A**-1`, when it exists. The
algebra conventions define each of them.

`min(a, b)` and `max(a, b)` require exactly two finite scalar arguments and
return a grade-zero multivector. With one argument, `min(L)`, `max(L)` and
`sum(L)` reduce a list to one value (#338). The argument shall evaluate to a
list; any other value is a `LANG_LIST_REQUIRED` diagnostic, so `min(a)` of a
scalar is an error, not the identity. `min(L)` and `max(L)` require pure
grade-zero elements and return the smallest or largest; an element that is
not scalar fails the call with its zero-based index, and an empty list is a
domain diagnostic. `sum(L)` adds the elements, which may be any multivectors,
with the algebra's addition, in list order; `sum([])` is scalar zero. A
reduction returns a single value, not a list, and a call with zero or three
arguments remains a syntax diagnostic. `atan2(y, x)` is the two-argument arc tangent,
the oriented angle of the direction `(x, y)` in `(-pi, pi]`; it is undefined at
the origin. Scalar functions broadcast over lists like every other operation of
section 11, elementwise for a list argument and pairwise for two lists of equal
length. Variadic forms, with more than two arguments, are not part of the
language.
Factorial is not part of the initial language.

Scalar functions reject non-finite results and produce a domain diagnostic
outside their real domain: `sqrt` of a negative value, `log` of a non-positive
value, `asin` and `acos` outside `[-1, 1]`, and `atan2(0, 0)`. `tan` also
produces a domain diagnostic at its representable poles using the
convention-version numeric comparison bound; these numerical boundary checks
do not alter any multivector grade or algebraic-domain classification.

`norm(A)` denotes the primary norm defined by the active algebra's versioned
conventions. `inorm(A)` is available only for an algebra that explicitly
defines an ideal norm. `normalize(A)` is `A / norm(A)` and `inormalize(A)` is
`A / inorm(A)`; a zero norm is a domain diagnostic and a non-finite one the
engine's non-finite diagnostic, never the value returned unchanged. Norm-bar syntax is not part of the language,
avoiding ambiguity with the infix `|` inner product. The evaluator shall not select a
different norm using a visual or geometric-classification heuristic. An
undefined norm produces a diagnostic.

Numerical tolerances are owned and tested by GAMUT, recorded through
`conventionVersion`, and used only where numerical decisions require them. They
do not redefine the mathematical operation. Precision and tolerance formulas,
including magnitude-relative terms where noise scales with magnitude, are
governed by ALG-031 in the
[algebra definition requirements](../requirements/algebras/algebra-definition.md).

## 11. Lists, broadcasting, and indexing

`[]` is a valid empty list. A list literal is `[expression, ...]`; a trailing
comma is allowed, but elisions such as `[a,,b]` are not. Lists may contain
expressions but not lists. Elements evaluate left to right for deterministic
diagnostic ordering, without observable side effects. Supported unary
operations, scalar functions, and postfix extractors distribute over lists and
preserve length and order. A function or operator not advertised as
distributive rejects a list argument. The scalar functions, `min` and `max`
included, broadcast like binary operations (section 10); the one-argument
reductions `min(L)`, `max(L)` and `sum(L)` consume a list and return one
value.

Binary operations follow these rules:

1. one list and one value: broadcast the value;
2. equal-length lists: combine elementwise;
3. a singleton and a longer list: broadcast the singleton;
4. unequal non-singleton lengths: error;
5. a value and `[]`, or `[]` and `[]`: return `[]`;
6. `[]` and a non-empty list: incompatible-length error.

Broadcasting applies once per operator node; it does not recursively reshape
values and never pads or truncates. For two singleton lists, the result has one
element. A list literal gives each element a stable derived identity based on
the owning item and element source span; a range gives each element a stable
derived identity based on the range expression and integer ordinal. Elementwise
operations derive result identities from the operator node and participating
element identities. Reevaluation that preserves those inputs preserves result
identity.

An element failure fails the complete expression, produces no partial list, and
identifies the zero-based element index and failing operand. Distributed results
retain each source element's identity and order. Propagation of non-language
metadata on evaluated-item records is governed by the
[document format specification](document-format.md) and never changes the
multivector or list value. Any operation that would create a nested list fails in
the initial scope.

`L[i]` requires a list and a finite, non-negative integer scalar index. Negative,
fractional, and out-of-range indices are errors. Indexing is zero-based and
returns the selected multivector, not a singleton list. Its evaluated-item record
retains the element identity and associated non-language metadata without adding
either to the multivector.

`L[I]`, where `I` evaluates to a list, performs gather indexing and returns a
list. Each member of `I` shall satisfy the same index rules as `i`; `[]` returns
`[]`. The result preserves index order and duplicates. Its elements receive
stable identities per gathered occurrence and retain the selected elements as
metadata sources. An invalid member fails the complete expression and the
diagnostic identifies its zero-based position in `I`. Indexing a non-list is a
type error. Slices and negative-from-end indexing are not supported in the
initial scope.

## 12. Ranges

`[start...end]` and `[start, next...end]` create arithmetic integer sequences.
The two-term form has step `+1` when `start <= end` and `-1` otherwise. The
three-term form has step `next-start`. All terms are evaluated once and shall be
finite integer scalars. The start is always included. The end is included only
when an integer number of steps reaches it; for example `[1,3...6]` is
`[1,3,5]`.

In the three-term form, a zero step or a step directed away from the end is an
error. Equal start and end produce a singleton regardless of the supplied
non-zero next term. Cardinality is calculated and checked before allocation. A
range that would generate more than 10,000 elements fails without producing a
truncated result.

## 13. Capability properties

Postfix property access has the form `object.property`, where `property` matches
the identifier grammar. The common language defines the syntax and two
families of properties; it does not hard-code algebra- or
interpretation-specific property names or meanings.

Properties specific to an algebra definition or geometry interpretation are a
planned extension: they will be registered through stable capability
descriptors, each declaring the receiver kinds it accepts, its result kind,
whether it distributes over lists, and the capability required for
evaluation. An unknown property, an invalid receiver, or an unavailable
capability produces the corresponding structured diagnostic. A distributive
property preserves list order and evaluated element identity; a
non-distributive property rejects a list receiver.

The two common-language families are both distributive: the grade
projection `A.gN` and the blade coefficient `A.eN`, in any generator order
(section 6). `.position` and `.head` are not properties of a value: they are
references to the separately evaluated position of a named item and to its
derived head (section 1, current implementation subset). A property is never a function:
operations on a value are written as calls (section 10), and the removed
version 1 properties, such as `A.norm`, produce an unsupported-property
diagnostic that names the function form.

Property access is read-only expression syntax. Top-level or nested property
assignment is not part of the language. Specific property semantics belong
to the requirement document that owns the registering algebra definition or
geometry interpretation.

## 14. Dependencies and failures

Names form an explicit dependency graph. Missing names, duplicate names, cycles,
syntax failures, domain failures, unsupported capabilities, upstream failures,
and internal failures are distinct diagnostics.

An invalid expression produces no value. Independent branches continue to
evaluate. All duplicate definitions are invalid and their users report an
ambiguous reference. Every member of a cycle reports the cycle; downstream
items report an upstream failure. No last-known-good result remains visible
silently. Correcting the cause automatically reevaluates dependants.

## 15. Versioning and future syntax

`languageVersion` is a positive integer. An incompatible syntax or semantic
change increments it. A strictly compatible addition may retain the version only
when it changes the interpretation of no previously valid source. Loading and
migration are explicit and deterministic.

The current version is 2. A document of a later version is refused. A
document of version 1 is migrated on load: in every expression source (item
sources, positions, slider bounds, appearance sources and the `${…}`
insertions of labels), each postfix `.reverse`, `.dual`, `.involution`,
`.inverse`, `.norm` and `.inorm` is rewritten as the call of the same name,
from the parse tree so that the operand keeps its grouping: `(A + B).norm`
becomes `norm(A + B)` and `A.inverse.norm` becomes `norm(inverse(A))`. A
source that does not parse is kept unchanged with its diagnostic, and notes
are text. Version 2 also reserves `normalize`, `inormalize`, `sum` and the
names of the operations, so a version 1 item declared with one of them
becomes a diagnostic.

Unknown function calls produce diagnostics. Syntax for user-defined and
parametric functions is not reserved by the initial language and requires a
later approved design. Dynamic appearance, factorial, slices, nested lists,
comprehensions, and higher-order operations are also outside this scope.
