'use strict'

const shimmer = require('shimmer')
const platform = require('../platform')

function createWrapExecute (tracer, config, defaultFieldResolver) {
  return function wrapExecute (execute) {
    return function executeWithTrace () {
      const args = normalizeArgs(arguments)
      const schema = args.schema
      const contextValue = args.contextValue || {}
      const fieldResolver = args.fieldResolver || defaultFieldResolver

      args.fieldResolver = wrapResolve(fieldResolver, tracer, config)
      args.contextValue = contextValue

      contextValue._datadog_spans = {}
      contextValue._datadog_resolvers = []

      if (!schema._datadog_patched) {
        wrapFields(schema._queryType._fields, tracer, config, [])
        schema._datadog_patched = true
      }

      let result = execute.call(this, args)

      if (result && typeof result.then === 'function') {
        result = result
          .then(value => {
            // trace(tracer, config, contextValue._datadog_resolvers)

            for (const key in contextValue._datadog_spans) {
              contextValue._datadog_spans[key].span.finish(contextValue._datadog_spans[key].finishTime)
            }

            return value
          })
      } else {
        for (const key in contextValue._datadog_spans) {
          console.log(contextValue._datadog_spans[key])
          contextValue._datadog_spans[key].span.finish(contextValue._datadog_spans[key].finishTime)
        }
        // trace(tracer, config, contextValue._datadog_resolvers)
      }

      return result
    }
  }
}

function trace (tracer, config, resolvers) {
  resolvers.forEach(resolver => {
    tracer.trace('graphql.query', span => {
      span.addTags({
        'service.name': config.service || (tracer._service && `${tracer._service}-graphql`) || 'graphql',
        'resource.name': resolver.path.join('.')
      })

      span._startTime = resolver.startTime

      addError(span, resolver.error)

      span.finish(resolver.duration)
    })
  })
}

function wrapFields (fields, tracer, config) {
  Object.keys(fields).forEach(key => {
    const field = fields[key]

    if (typeof field.resolve === 'function') {
      field.resolve = wrapResolve(field.resolve, tracer, config)
    }

    if (field.type && field.type._fields) {
      wrapFields(field.type._fields, tracer, config)
    }
  })
}

function wrapResolve (resolve, tracer, config) {
  return function resolveWithTrace (source, args, contextValue, info) {
    const path = getPath(info.path)
    const resolverContext = {
      'path': path,
      'parentType': info.parentType,
      'fieldName': info.fieldName,
      'returnType': info.returnType,
      'startTime': platform.now()
    }
    // console.log(info)

    let result

    if (!info.path.prev) {
      contextValue._datadog_spans[path] = {
        span: createQuerySpan(tracer, config)
      }
    }

    tracer.trace('graphql.resolve', {
      childOf: contextValue._datadog_spans[path[0]].span
    }, span => {
      span.addTags({
        'service.name': config.service || (tracer._service && `${tracer._service}-graphql`) || 'graphql',
        'resource.name': path.join('.')
      })

      try {
        result = resolve.apply(this, arguments)

        if (result && typeof result.then === 'function') {
          result = result
            .then(value => {
            // finish(resolverContext, contextValue)
              span.finish()
              contextValue._datadog_spans[path[0]].finishTime = platform.now()
              return value
            })
            .catch(err => {
            // finish(resolverContext, contextValue, err)
              contextValue._datadog_spans[path[0]].finishTime = platform.now()
              finishAndThrow(span, err)
            })
        } else {
        // finish(resolverContext, contextValue)
          contextValue._datadog_spans[path[0]].finishTime = platform.now()
          span.finish()
        }
      } catch (e) {
      // finish(resolverContext, contextValue, e)
        contextValue._datadog_spans[path[0]].finishTime = platform.now()
        finishAndThrow(span, e)
      }
    })

    return result
  }
}

function createQuerySpan (tracer, config) {
  let span

  tracer.trace('graphql.query', parent => {
    span = parent
  })

  return span
}

function finish (resolverContext, contextValue, error) {
  resolverContext.duration = platform.now() - resolverContext.startTime
  resolverContext.error = error

  contextValue._datadog_resolvers.push(resolverContext)

  if (error) {
    throw error
  }
}

function normalizeArgs (args) {
  if (args.length === 1) {
    return args[0]
  }

  return {
    schema: args[0],
    document: args[1],
    rootValue: args[2],
    contextValue: args[3],
    variableValues: args[4],
    operationName: args[5],
    fieldResolver: args[6]
  }
}

function getPath (path) {
  if (path.prev) {
    return getResource(path.prev).concat(path.key)
  } else {
    return [path.key]
  }
}

function getResource (path) {
  if (path.prev) {
    return getResource(path.prev).concat(path.key)
  } else {
    return [path.key]
  }
}

function finishAndThrow (span, error) {
  addError(span, error)
  span.finish()
  throw error
}

function addError (span, error) {
  if (error) {
    span.addTags({
      'error.type': error.name,
      'error.msg': error.message,
      'error.stack': error.stack
    })
  }

  return error
}

module.exports = {
  name: 'graphql',
  file: 'execution/execute.js',
  versions: ['>=0.13.0 <1.0.0'],
  patch (execute, tracer, config) {
    shimmer.wrap(execute, 'execute', createWrapExecute(tracer, config, execute.defaultFieldResolver))
  },
  unpatch (execute) {
    shimmer.unwrap(execute, 'execute')
  }
}
