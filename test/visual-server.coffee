# serve the visual test files
path = require 'path'
Hapi = require 'hapi'

console.log path.join __dirname, 'index.html'
server = new Hapi.Server()
server.connection { port: 4242 }
server.route {
  method: 'GET'
  path: '/'
  handler: {file: 'test/index.html'}
}
server.route {
  method: 'GET'
  path: '/{param*}'
  handler: {directory: {path: '.'}}
}
server.start -> console.log "visual test server running at: #{server.info.uri}"
