import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildAnswerPresentation,
  peelEmbeddedNumberedSources,
  sanitizeAnswerParagraph,
  stripMarkdownHttpLinks,
} from '../apps/holocron-web/src/lib/answer-presentation.ts'

describe('stripMarkdownHttpLinks', () => {
  it('strips spaced markdown links', () => {
    const raw =
      '[icon.png] (https://raw.githubusercontent.com/KobaltBlu/KotOR.js/master/src/assets/icons/icon.png)'
    const out = stripMarkdownHttpLinks(raw)
    assert.equal(out, 'icon.png')
  })

  it('drops image-only markdown', () => {
    const raw = '![alt](https://example.com/a.png) KotOR.js remake'
    const out = stripMarkdownHttpLinks(raw)
    assert.match(out, /KotOR\.js remake/)
    assert.doesNotMatch(out, /example\.com/)
  })
})

describe('sanitizeAnswerParagraph', () => {
  it('preserves numeric citation markers', () => {
    const raw = 'The reone project provides engine work [1] and KotOR.js ports TypeScript [3].'
    const out = sanitizeAnswerParagraph(raw)
    assert.match(out, /\[1\]/)
    assert.match(out, /\[3\]/)
  })
})

describe('peelEmbeddedNumberedSources', () => {
  it('moves trailing numbered bibliography into sourceText', () => {
    const raw = [
      'The reone project is an open-source Odyssey engine reimplementation [1].',
      '1. reone - https://github.com/seedhartha/reone',
      '2. KotOR.js - https://github.com/KobaltBlu/KotOR.js',
    ].join('\n')
    const split = peelEmbeddedNumberedSources(raw)
    assert.match(split.answerText, /reone project/)
    assert.match(split.sourceText, /^1\./m)
  })

  it('treats source-only numbered answers as bibliography', () => {
    const raw = [
      '1. reone Odyssey engine - https://github.com/seedhartha/reone',
      '2. reone wiki - https://github.com/seedhartha/reone/wiki',
    ].join('\n')
    const split = peelEmbeddedNumberedSources(raw)
    assert.equal(split.answerText, '')
    assert.match(split.sourceText, /reone wiki/)
  })
})

describe('formatSourceDisplayName via buildAnswerPresentation', () => {
  it('labels malformed GitHub blob paths as README.md#Ln', () => {
    const presentation = buildAnswerPresentation('', [
      {
        name: 'github.com',
        url: 'https://github.com/KobaltBlu/KotOR.js/blob/master/githubusercontent.com/KobaltBlu/KotOR.js#L1',
        confidence: 1,
      },
    ])
    assert.equal(presentation.sources[0]?.name, 'README.md#L1')
  })
})

describe('buildAnswerPresentation', () => {
  it('parses explicit API sources when body is bibliography-only', () => {
    const content = [
      '1. reone - https://github.com/seedhartha/reone',
      '2. KotOR.js - https://github.com/KobaltBlu/KotOR.js',
    ].join('\n')
    const presentation = buildAnswerPresentation(content, [
      { name: 'reone', url: 'https://github.com/seedhartha/reone', confidence: 1 },
      { name: 'KotOR.js', url: 'https://github.com/KobaltBlu/KotOR.js', confidence: 1 },
    ])
    assert.equal(presentation.isSourceOnly, true)
    assert.equal(presentation.sources.length, 2)
  })
})
