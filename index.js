module.exports = Level

var AbstractLevelDOWN = require('abstract-leveldown').AbstractLevelDOWN
var inherits = require('inherits')
var Iterator = require('./iterator')
var isBuffer = require('isbuffer')
var xtend = require('xtend')
var toBuffer = require('typedarray-to-buffer')

function Level(location) {
  if (!(this instanceof Level)) return new Level(location)
  if (!location) throw new Error("constructor requires at least a location argument")
  this.IDBOptions = {}
  this.location = location
}

inherits(Level, AbstractLevelDOWN)

Level.prototype._open = function(options, callback) {
  var self = this
    
  var idbOpts = {
    storeName: this.location,
    autoIncrement: false,
    keyPath: null,
  }
  xtend(idbOpts, options)
  this.IDBOptions = idbOpts

  var IDB = options.idb || getIDB()
  var r = IDB.open(idbOpts.storeName)
  r.addEventListener('upgradeneeded', function () {
    var db = r.result
    db.createObjectStore('data')
  })
  r.addEventListener('error', callback)
  r.addEventListener('success', function () {
    self.idb = r.result
    callback(null, self.idb)
  })
}

Level.prototype._get = function (key, options, callback) {
  var tx = this.idb.transaction(['data'], 'readonly')
  var store = tx.objectStore('data')
  tx.addEventListener('error', callback)

  var r = store.get(key)
  r.addEventListener('success', function (ev) {
    var value = ev.target.result
    if (value === undefined) {
      // 'NotFound' error, consistent with LevelDOWN API
      return callback(new Error('NotFound'))
    }
    // by default return buffers, unless explicitly told not to
    var asBuffer = true
    if (options.asBuffer === false) asBuffer = false
    if (options.raw) asBuffer = false
    if (asBuffer) {
      if (value instanceof Uint8Array) value = toBuffer(value)
      else value = new Buffer(String(value))
    }
    return callback(null, value, key)
  })
  r.addEventListener('error', callback)
}

Level.prototype._del = function(id, options, callback) {
  var tx = this.idb.transaction(['data'], 'readwrite')
  var store = tx.objectStore('data')
  var r = store.delete(id)
  r.addEventListener('error', callback)
  r.addEventListener('success', function () { callback(null) })
}

Level.prototype._put = function (key, value, options, callback) {
  if (value instanceof ArrayBuffer) {
    value = toBuffer(new Uint8Array(value))
  }
  var obj = this.convertEncoding(key, value, options)
  if (Buffer.isBuffer(obj.value)) {
    obj.value = new Uint8Array(value.toArrayBuffer())
  }
  var tx = this.idb.transaction(['data'], 'readwrite')
  var store = tx.objectStore('data')
  var r = store.put(obj.value, obj.key)
  r.addEventListener('success', function (ev) { callback(null, ev) })
  r.addEventListener('error', callback)
}

Level.prototype.convertEncoding = function(key, value, options) {
  if (options.raw) return {key: key, value: value}
  if (value) {
    var stringed = value.toString()
    if (stringed === 'NaN') value = 'NaN'
  }
  var valEnc = options.valueEncoding
  var obj = {key: key, value: value}
  if (value && (!valEnc || valEnc !== 'binary')) {
    if (typeof obj.value !== 'object') {
      obj.value = stringed
    }
  }
  return obj
}

Level.prototype.iterator = function (options) {
  if (typeof options !== 'object') options = {}
  return new Iterator(this.idb, options)
}

Level.prototype._batch = function (array, options, callback) {
  var op
  var i
  var k
  var copiedOp
  var currentOp
  var modified = []
  
  if (array.length === 0) return setTimeout(callback, 0)
  
  for (i = 0; i < array.length; i++) {
    copiedOp = {}
    currentOp = array[i]
    modified[i] = copiedOp
    
    var converted = this.convertEncoding(currentOp.key, currentOp.value, options)
    currentOp.key = converted.key
    currentOp.value = converted.value

    for (k in currentOp) {
      if (k === 'type' && currentOp[k] == 'del') {
        copiedOp[k] = 'remove'
      } else {
        copiedOp[k] = currentOp[k]
      }
    }
  }

  // remove duplicate keys in the same batch:
  var keys = {}
  for (i = modified.length-1; i >= 0; i--) {
    if (!modified[i]) continue
    var key = modified[i].key
    if (Object.hasOwnProperty.call(keys, key)) {
      modified.splice(i, 1)
    }
    keys[key] = true
  }

  var tx = this.idb.transaction(['data'], 'readwrite')
  tx.addEventListener('error', callback)
  tx.addEventListener('complete', function () { callback(null) })
  var store = tx.objectStore('data')
  modified.forEach(function (op) {
    if (op.type === 'put') {
      store.put(op.value, op.key)
    } else if (op.type === 'remove') {
      store.delete(op.key)
    }
  })
}

Level.prototype._close = function (callback) {
  this.idb.close()
  callback()
}

Level.prototype._approximateSize = function (start, end, callback) {
  var err = new Error('Not implemented')
  if (callback)
    return callback(err)

  throw err
}

Level.prototype._isBuffer = function (obj) {
  return Buffer.isBuffer(obj)
}

Level.destroy = function (db, callback) {
  if (typeof db === 'object') {
    var prefix = db.IDBOptions.storePrefix || 'IDBWrapper-'
    var dbname = db.location
  } else {
    var prefix = 'IDBWrapper-'
    var dbname = db
  }
  var request = getIDB().deleteDatabase(prefix + dbname)
  request.onsuccess = function() {
    callback()
  }
  request.onerror = function(err) {
    callback(err)
  }
}

function getIDB () {
  var w = typeof global !== 'undefined' ? global : {}
  return w.indexedDB || w.mozIndexedDB
    || w.webkitIndexedDB || w.msIndexedDB
}
