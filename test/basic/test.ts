import { unfurl } from '../../src/'
import nock from 'nock'

test('should handle content which is escaped badly', async () => {
  nock('http://localhost')
    .get('/html/double-escaped-edge-case')
    .replyWithFile(200, __dirname + '/double escaped-edge-case.html', {
      'Content-Type': 'text/html'
    })

  const result = await unfurl('http://localhost/html/double-escaped-edge-case')

  expect(result.description).toEqual('"')
})

test('should detect title, description and keywords', async () => {
  nock('http://localhost')
    .get('/html/basic')
    .replyWithFile(200, __dirname + '/basic.html', {
      'Content-Type': 'text/html'
    })

  const result = await unfurl('http://localhost/html/basic')

  const expected = {
    favicon: 'http://localhost/favicon.ico',
    author: 'abc',
    description: 'aaa',
    keywords: ['a', 'b', 'c'],
    title: 'ccc'
  }

  expect(result).toEqual(expected)
})

test('should detect title, description and keywords even when they are in the body', async () => {
  nock('http://localhost')
    .get('/html/basic-body')
    .replyWithFile(200, __dirname + '/basic-body.html', {
      'Content-Type': 'text/html'
    })

  const result = await unfurl('http://localhost/html/basic-body')

  const expected = {
    favicon: 'http://localhost/favicon.ico',
    description: 'aaa',
    keywords: ['a', 'b', 'c'],
    title: 'ccc'
  }

  expect(result).toEqual(expected)
})

test('should detect last dupe of title, description and keywords', async () => {
  nock('http://localhost')
    .get('/html/basic-duplicates')
    .replyWithFile(200, __dirname + '/basic-duplicates.html', {
      'Content-Type': 'text/html'
    })

  const result = await unfurl('http://localhost/html/basic-duplicates')

  const expected = {
    favicon: 'http://localhost/favicon.ico',
    description: 'aaa',
    keywords: ['a', 'b', 'c'],
    title: 'ccc'
  }

  expect(result).toEqual(expected)
})

test('should detect last dupe of title, description and keywords', async () => {
  nock('http://localhost')
  .get('/html/keyword-edge-cases')
  .replyWithFile(200, __dirname + '/keyword-edge-cases.html', {
    'Content-Type': 'text/html'
  })

  const result = await unfurl('http://localhost/html/keyword-edge-cases')

  const expected = {
    favicon: 'http://localhost/favicon.ico',
    keywords: ['foo', 'bar', 'baz quix', 'foo', 'foo']
  }

  expect(result).toEqual(expected)
})
