# parser for arithmetic expressions in gerber aperture macros

# regex matches
OPERATOR = /[\+\-\/xX\(\)]/
NUMBER = /[\$\d\.]+/
TOKEN = new RegExp "(#{OPERATOR.source})|(#{NUMBER.source})", 'g'

# split apart a arithmetic string into individual tokens
tokenize = (arith) ->
  results = arith.match TOKEN

# identify a token as a number / modifier
isNumber = (token) ->
  NUMBER.test token

# parse an arithmetic string into operation nodes and return the top node
parse = (arith) ->
  tokens = tokenize arith
  index = 0

  # some helper functions
  peek = -> tokens[index]
  consume = (t) -> index++
  # recursive parsing functions
  # highest priority - numbers and parentheses
  parsePrimary = ->
    t = peek()
    consume t
    if isNumber t
      exp = { type: 'n', val: t }
    else if t is '('
      exp = parseExpression()
      if peek() isnt ')'
        throw new Error 'unmatched parentheses while parsing a macro expression'
      else
        consume ')'
    else
      throw new Error "#{arith} is a poorly formatted expression"
    exp

  # second highest priority - multiplication and division
  parseMultiplication = ->
    exp = parsePrimary()
    t = peek()
    while t is 'x' or t is '/'
      consume t
      rhs = parsePrimary()
      exp = { type: t, left: exp, right: rhs }
      t = peek()
    exp

  # lowest priority - addition and subtraction
  parseExpression = ->
    exp = parseMultiplication()
    t = peek()
    while t is '+' or t is '-'
      consume t
      rhs = parseMultiplication()
      exp = { type: t, left: exp, right: rhs }
      t = peek()
    exp

  parseExpression()

module.exports = {
  tokenize: tokenize
  isNumber: isNumber
  parse: parse
}
