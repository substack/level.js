var AbstractIterator = require('abstract-leveldown').AbstractIterator
var inherits = require('inherits')
var EventEmitter = require('events').EventEmitter

module.exports = Iterator
inherits(Iterator, AbstractIterator)

function Iterator (idb, opts) {
  if (!opts) opts = {}
  var self = this
  AbstractIterator.call(this, idb)
  self._idb = idb
  self._queue = []
  self._errors = []
  self._ev = new EventEmitter
  self._limit = opts.limit

  var w = typeof global !== 'undefined' ? global : {}
  var Range = opts.range || w.IDBKeyRange || w.mozIDBKeyRange
    || w.webkitIDBKeyRange || w.msIDBKeyRange

  var range = undefined
  if (opts.lt !== undefined && opts.gt !== undefined) {
    range = Range.bound(fix(opts.gt), fix(opts.lt), true, true)
  } else if (opts.lt !== undefined && opts.gte !== undefined) {
    range = Range.bound(fix(opts.gte), fix(opts.lt), false, true)
  } else if (opts.lte !== undefined && opts.gt !== undefined) {
    range = Range.bound(fix(opts.gt), fix(opts.lte), true, false)
  } else if (opts.lte !== undefined && opts.gte !== undefined) {
    range = Range.bound(fix(opts.lte), fix(opts.gte))
  } else if (opts.lt !== undefined) {
    range = Range.upperBound(fix(opts.lt), true)
  } else if (opts.lte !== undefined) {
    range = Range.upperBound(fix(opts.lte))
  } else if (opts.gt !== undefined) {
    range = Range.lowerBound(fix(opts.gt), true)
  } else if (opts.gte !== undefined) {
    range = Range.lowerBound(fix(opts.gte))
  }
  function fix (x) { return x.toString() }

  var tx = idb.transaction(['data'], 'readonly')
  var store = tx.objectStore('data')
  var cur = store.openCursor(range)
  cur.addEventListener('error', function (err) {
    self._errors.push(err)
    if (self._errors.length + self._queue.length === 1) {
      self._ev.emit('_readable')
    }
  })
  var n = 0
  cur.addEventListener('success', function (ev) {
    var cur = ev.target.result
    self._queue.push(cur)
    if (cur && self._limit && ++n >= self._limit) {
      self._queue.push(undefined)
    } else if (cur) cur['continue']()
    if (self._errors.length + self._queue.length === 1) {
      self._ev.emit('_readable')
    }
  })
}

Iterator.prototype._next = function f (cb) {
  var self = this
  if (self._errors.length) ntick(cb, self, self._errors.shift())
  else if (self._queue.length) {
    var q = self._queue.shift()
    if (!q) ntick(cb, self)
    else ntick(cb, self, null, q.key, q.value)
  }
  else {
    self._ev.once('_readable', function () { f.call(self, cb) })
  }
}

Iterator.prototype._end = function (cb) { ntick(cb) }

function ntick (cb, ctx) {
  var args = [].slice.call(arguments, 2)
  process.nextTick(function () { cb.apply(ctx, args) })
}
