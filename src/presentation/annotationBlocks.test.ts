import { describe, expect, it } from 'vitest'
import { annotationBlocksPlainText, MAX_QUOTE_DEPTH, parseAnnotationBlocks, type AnnotationBlock } from './annotationBlocks'
import { annotationPlainText } from './annotationText'

/** A compact reading of blocks: their kind and plain text. */
function outline(blocks: readonly AnnotationBlock[]): unknown[] {
  return blocks.map((block) => {
    switch (block.kind) {
      case 'paragraph': return ['p', annotationPlainText(block.children)]
      case 'heading': return [`h${block.level}`, annotationPlainText(block.children)]
      case 'code': return ['code', block.text]
      case 'rule': return ['rule']
      case 'quote': return ['quote', outline(block.children)]
      case 'list': return [block.ordered ? `ol${block.start}` : 'ul', block.items.map((item) =>
        item.sublist ? [annotationPlainText(item.children), outline([item.sublist])[0]] : annotationPlainText(item.children))]
    }
  })
}
const parse = (text: string) => outline(parseAnnotationBlocks(text))

describe('annotation blocks', () => {
  it('reads paragraphs separated by blank lines and keeps their line breaks', () => {
    expect(parse('One **two**\nthree\n\n  four  ')).toEqual([['p', 'One two\nthree'], ['p', 'four']])
    expect(parse('')).toEqual([])
    expect(parse('\n \n')).toEqual([])
  })

  it('reads headings of level 1 to 3 and nothing else as a heading', () => {
    expect(parse('# Title\n## Sub *title* ##\n### Small')).toEqual([['h1', 'Title'], ['h2', 'Sub title'], ['h3', 'Small']])
    // No space, four #, or no text: a paragraph.
    expect(parse('#tag')).toEqual([['p', '#tag']])
    expect(parse('#### deep')).toEqual([['p', '#### deep']])
    expect(parse('#')).toEqual([['p', '#']])
    expect(parse('C# is a language')).toEqual([['p', 'C# is a language']])
    // A closing run needs a space before it.
    expect(parse('# C#')).toEqual([['h1', 'C#']])
    // An escaped # is text.
    expect(parse('\\# not a title')).toEqual([['p', '# not a title']])
  })

  it('reads bullet and numbered lists with one nested level', () => {
    expect(parse('- one\n- two\n  - inner a\n  - inner b\n- three')).toEqual([
      ['ul', ['one', ['two', ['ul', ['inner a', 'inner b']]], 'three']],
    ])
    expect(parse('3. three\n4) four\n   1. nested')).toEqual([['ol3', ['three', ['four', ['ol1', ['nested']]]]]])
    // An indented line continues its item; a blank line ends the list.
    expect(parse('- first\n  continued\n\nafter')).toEqual([['ul', ['first\ncontinued']], ['p', 'after']])
    // A change of marker type starts another list.
    expect(parse('- a\n1. b')).toEqual([['ul', ['a']], ['ol1', ['b']]])
    // Emphasis, products, and negative numbers are not bullets.
    expect(parse('*italic* text')).toEqual([['p', 'italic text']])
    expect(parse('-3 + 2')).toEqual([['p', '-3 + 2']])
    expect(parse('\\- literal')).toEqual([['p', '- literal']])
    expect(parse('1\\. literal')).toEqual([['p', '1. literal']])
  })

  it('lets only a list that starts at 1 interrupt a paragraph', () => {
    expect(parse('In\n2026. it was done')).toEqual([['p', 'In\n2026. it was done']])
    expect(parse('Steps\n1. first')).toEqual([['p', 'Steps'], ['ol1', ['first']]])
    expect(parse('Items\n- first')).toEqual([['p', 'Items'], ['ul', ['first']]])
  })

  it('reads quotes that hold blocks', () => {
    expect(parse('> # Title\n> text\n>\n> - item\nafter')).toEqual([
      ['quote', [['h1', 'Title'], ['p', 'text'], ['ul', ['item']]]],
      ['p', 'after'],
    ])
    expect(parse('> a\n> > b')).toEqual([['quote', [['p', 'a'], ['quote', [['p', 'b']]]]]])
    expect(parse('\\> literal')).toEqual([['p', '> literal']])
  })

  it('shows a code block as written, without inline parsing', () => {
    expect(parse('```js\nconst a = **1**\n  # not a title\n```\nafter')).toEqual([
      ['code', 'const a = **1**\n  # not a title'],
      ['p', 'after'],
    ])
    // A longer fence holds a shorter one; tildes work too; an unclosed fence runs to the end.
    expect(parse('````\n```\n````')).toEqual([['code', '```']])
    expect(parse('~~~\n- x')).toEqual([['code', '- x']])
    // Three backticks with a backtick after them are inline code.
    expect(parse('```a``` b')).toEqual([['p', 'a b']])
  })

  it('reads a rule, also between list-like characters', () => {
    expect(parse('above\n---\nbelow')).toEqual([['p', 'above'], ['rule'], ['p', 'below']])
    expect(parse('* * *')).toEqual([['rule']])
    expect(parse('___')).toEqual([['rule']])
    expect(parse('--')).toEqual([['p', '--']])
    expect(parse('- - x')).toEqual([['ul', ['- x']]])
  })

  it('keeps the lines of display mathematics out of the other blocks', () => {
    const blocks = parseAnnotationBlocks('Before\n$$\na\n- b\n> c\n# d\n$$\nAfter')
    expect(blocks).toEqual([
      { kind: 'paragraph', children: [{ kind: 'text', text: 'Before' }] },
      { kind: 'paragraph', children: [{ kind: 'math', tex: 'a\n- b\n> c\n# d', display: true }] },
      { kind: 'paragraph', children: [{ kind: 'text', text: 'After' }] },
    ])
    expect(parseAnnotationBlocks('$$x^2$$')).toEqual([{ kind: 'paragraph', children: [{ kind: 'math', tex: 'x^2', display: true }] }])
    // Without a closing $$ the lines are ordinary blocks.
    expect(parse('$$\n- item')).toEqual([['p', '$$'], ['ul', ['item']]])
    expect(annotationBlocksPlainText(parseAnnotationBlocks('# Title\n- $x$\n  - **y**\n\n---\n> q'))).toBe('Title\nx\ny\nq')
  })

  it('never produces HTML: markup is text', () => {
    expect(parse('<h1>x</h1>\n<script>alert(1)</script>')).toEqual([['p', '<h1>x</h1>\n<script>alert(1)</script>']])
    expect(parse('![alt](https://example.org/a.png)')).toEqual([['p', '![alt](https://example.org/a.png)']])
  })

  it('stops nesting quotes at the depth limit', () => {
    let depth = 0
    let blocks = parseAnnotationBlocks(`${'>'.repeat(MAX_QUOTE_DEPTH + 4)} deep`)
    while (blocks[0]?.kind === 'quote') {
      depth += 1
      blocks = [...blocks[0].children]
    }
    expect(depth).toBe(MAX_QUOTE_DEPTH)
    expect(outline(blocks)).toEqual([['p', '>>>> deep']])
  })

  it('stays fast on sources at the source limit', () => {
    const limit = 65_536
    const sources = [
      `# ${' '.repeat(limit)}x`,
      `#${' #'.repeat(limit / 2)}`,
      '>'.repeat(limit),
      '> '.repeat(limit / 2),
      `${'- '.repeat(limit / 2)}`,
      '-\n'.repeat(limit / 2),
      '- a\n'.repeat(limit / 4),
      `${' '.repeat(limit / 2)}- x\n`.repeat(2),
      '`'.repeat(limit),
      `\`\`\`\n${'x\n'.repeat(limit / 2)}`,
      '* '.repeat(limit / 2) + 'x',
      '1. '.repeat(limit / 3),
      '$$ x\n'.repeat(limit / 5),
    ]
    const started = performance.now()
    for (const source of sources) parseAnnotationBlocks(source)
    expect(performance.now() - started).toBeLessThan(2000)
  })
})
