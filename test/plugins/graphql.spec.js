'use strict'

const agent = require('./agent')

describe('Plugin', () => {
  let plugin
  let context
  let graphql
  let schema

  describe('graphql', () => {
    beforeEach(() => {
      plugin = require('../../src/plugins/graphql')
      graphql = require('graphql')
      context = require('../../src/platform').context({ experimental: { asyncHooks: false } })

      schema = new graphql.GraphQLSchema({
        query: new graphql.GraphQLObjectType({
          name: 'RootQueryType',
          fields: {
            hello: {
              type: graphql.GraphQLString,
              args: {
                name: {
                  type: graphql.GraphQLString
                }
              },
              resolve (obj, args) {
                return args.name
              }
            },
            human: {
              type: new graphql.GraphQLObjectType({
                name: 'Human',
                fields: {
                  name: {
                    type: graphql.GraphQLString,
                    resolve (obj, args) {
                      return obj
                    }
                  }
                }
              }),
              resolve (obj, args) {
                return 'test' // Promise.resolve('test')
              }
            }
          }
        })
      })
    })

    afterEach(() => {
      agent.close()
    })

    describe('without configuration', () => {
      beforeEach(() => {
        return agent.load(plugin, 'graphql')
      })

      it('should instrument schema resolvers', done => {
        const source = `{ hello(name: "world") }`

        agent
          .use(traces => {
            expect(traces[0][0]).to.have.property('service', 'test-graphql')
            expect(traces[0][0]).to.have.property('resource', 'hello')
          }, 2)
          .then(done)
          .catch(done)

        graphql.graphql(schema, source).catch(done)
      })

      it('should instrument nested field resolvers', done => {
        const source = `{ human { name } }`

        agent
          .use(traces => {
            expect(traces[0][0]).to.have.property('resource', 'human.name')
          }, 2)
          .then(done)
          .catch(done)

        graphql.graphql(schema, source).catch(done)
      })

      it('should instrument the default field resolver', done => {
        const schema = graphql.buildSchema(`
          type Query {
            hello: String
          }
        `)

        const source = `{ hello }`

        agent
          .use(traces => {
            expect(traces[0][0]).to.have.property('resource', 'hello')
          })
          .then(done)
          .catch(done)

        graphql.graphql(schema, source, { hello: 'world' }).catch(done)
      })

      it('should instrument a custom field resolver', done => {
        const schema = graphql.buildSchema(`
          type Query {
            hello: String
          }
        `)

        const source = `{ hello }`

        const rootValue = { hello: 'world' }

        const fieldResolver = (source, args, contextValue, info) => {
          return source[info.fieldName]
        }

        agent
          .use(traces => {
            expect(traces[0][0]).to.have.property('resource', 'hello')
          })
          .then(done)
          .catch(done)

        graphql.graphql({ schema, source, rootValue, fieldResolver }).catch(done)
      })

      it('should run the resolver in the trace context', done => {
        const schema = graphql.buildSchema(`
          type Query {
            hello: String
          }
        `)

        const source = `{ hello }`

        const rootValue = { hello: 'world' }

        const fieldResolver = (source, args, contextValue, info) => {
          expect(context.get('current')).to.not.be.undefined
          done()
          return source[info.fieldName]
        }

        graphql.graphql({ schema, source, rootValue, fieldResolver }).catch(done)
      })

      it('should run nested resolvers in the parent context')

      it('should handle exceptions', done => {
        const error = new Error('test')

        const schema = graphql.buildSchema(`
          type Query {
            hello: String
          }
        `)

        const source = `{ hello }`

        const fieldResolver = (source, args, contextValue, info) => {
          throw error
        }

        agent
          .use(traces => {
            expect(traces[0][0]).to.have.property('error', 1)
            expect(traces[0][0].meta).to.have.property('error.type', error.name)
            expect(traces[0][0].meta).to.have.property('error.msg', error.message)
            expect(traces[0][0].meta).to.have.property('error.stack', error.stack)
          })
          .then(done)
          .catch(done)

        graphql.graphql({ schema, source, fieldResolver }).catch(done)
      })

      it('should handle rejected promises', done => {
        const error = new Error('test')

        const schema = graphql.buildSchema(`
          type Query {
            hello: String
          }
        `)

        const source = `{ hello }`

        const fieldResolver = (source, args, contextValue, info) => {
          return Promise.reject(error)
        }

        agent
          .use(traces => {
            expect(traces[0][0]).to.have.property('error', 1)
            expect(traces[0][0].meta).to.have.property('error.type', error.name)
            expect(traces[0][0].meta).to.have.property('error.msg', error.message)
            expect(traces[0][0].meta).to.have.property('error.stack', error.stack)
          })
          .then(done)
          .catch(done)

        graphql.graphql({ schema, source, fieldResolver }).catch(done)
      })
    })
  })
})
