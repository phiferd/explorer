var mongoose = require( 'mongoose' );
require( '../db-internal.js' );
var Block     = mongoose.model( 'Block' );
var InternalTx     = mongoose.model( 'InternalTransaction' );
var Transaction     = mongoose.model( 'Transaction' );

var filters = require('./filters');

// TODO: Move these settings to a config file
var samplePercentage = 50;
var Musicoin = require('Musicoin-core');
var musicoinCore = new Musicoin({
  web3Host: 'http://localhost:8545',
  ipfsHost: 'http://localhost:8080'
});


var async = require('async');

module.exports = function(app){
  var web3relay = require('./web3relay');

  var DAO = require('./dao');

  var compile = require('./compiler');
  var fiat = require('./fiat');
  var stats = require('./stats');

  /*
    Local DB: data request format
    { "address": "0x1234blah", "txin": true }
    { "tx": "0x1234blah" }
    { "block": "1234" }
  */
  app.post('/addr', getAddr);
  app.post('/internal', getInternalTx);
  app.post('/tx', getTx);
  app.post('/block', getBlock);
  app.post('/data', getData);

  app.post('/daorelay', DAO);
  app.post('/web3relay', web3relay.data);
  app.post('/compile', compile);

  app.post('/fiat', fiat);
  app.post('/stats', stats);

  app.get('/sample/:address', function(req, res) {
    musicoinCore.getLicenseModule().sampleResourceStream(req.params.address, samplePercentage)
      .then(function (result) {
        res.writeHead(200, result.headers);
        result.stream.pipe(res);
      })
      .catch(function (err) {
        res.status(500)
        res.send(err);
      });
  });

  app.get('/ipfs/:hash', function(req, res) {
    musicoinCore.getMediaProvider().getRawIpfsResource(req.params.hash)
      .then(function (result) {
        res.writeHead(200, result.headers);
        result.stream.pipe(res);
      })
      .catch(function (err) {
        res.status(500)
        res.send(err);
      });
  });
}

var getAddr = function(req, res){
  // TODO: validate addr and tx
  var addr = req.body.addr.toLowerCase();
  var count = parseInt(req.body.count);

  var limit = parseInt(req.body.length);
  var start = parseInt(req.body.start);

  var data = { draw: parseInt(req.body.draw), recordsFiltered: count, recordsTotal: count };

  var addrFind = InternalTx.find( { $or: [{"action.to": addr}, {"action.from": addr}] })

  addrFind.lean(true).sort('-blockNumber').skip(start).limit(limit)
          .exec("find", function (err, docs) {
            if (docs)
              data.data = filters.filterTX(docs, addr);
            else
              data.data = [];
            res.write(JSON.stringify(data));
            res.end();
          });

};



var getBlock = function(req, res) {

  // TODO: support queries for block hash
  var txQuery = "number";
  var number = parseInt(req.body.block);

  var blockFind = Block.findOne( { number : number }).lean(true);
  blockFind.exec(function (err, doc) {
    if (err || !doc) {
      console.error("BlockFind error: " + err)
      console.error(req.body);
      res.write(JSON.stringify({"error": true}));
    } else {
      var block = filters.filterBlocks([doc]);
      res.write(JSON.stringify(block[0]));
    }
    res.end();
  });

};

var getTx = function(req, res){

  var tx = req.body.tx.toLowerCase();
  console.log("findinging: " +tx)

  var txFind = Transaction.findOne( { "hash" : tx }, "hash value blockNumber timestamp gas gasPrice input nonce from to type")
                  .lean(true);
  txFind.exec(function (err, doc) {
    if (!doc){
      console.log("missing: " +tx)
      res.write(JSON.stringify({}));
      res.end();
    } else {
      // filter transactions
      //var txDocs = filters.filterBlock(doc, "hash", tx)
      doc.value = filters.calEth(doc.value);
      console.log("Here it is: " + JSON.stringify(doc));
      res.write(JSON.stringify(doc));
      res.end();
    }
  });

};

var getInternalTx = function(req, res){

  var addr = req.body.addr.toLowerCase();
  var limit = parseInt(req.body.length);
  var start = parseInt(req.body.start);

  var count = req.body.count;

  var data = { draw: parseInt(req.body.draw) };


  var txFind = InternalTx.find( { "action.callType" : "call",
                  $or: [{"action.from": addr}, {"action.to": addr}] }, "action transactionHash blockNumber timestamp")
                  .lean(true).sort('-blockNumber').skip(start).limit(limit)

  async.parallel([
    function(cb) {
      if (count) {
        data.recordsFiltered = parseInt(count);
        data.recordsTotal = parseInt(count);
        cb();
        return;
      }
      InternalTx.find( { "action.callType" : "call",
                  $or: [{"action.from": addr}, {"action.to": addr}] })
                .count(function(err, count) {
                    data.recordsFiltered = count;
                    data.recordsTotal = count;
                    cb()
                  });
    }, function(cb) {
      txFind.exec("find", function (err, docs) {
        if (docs)
          data.data = filters.internalTX(docs);
        else
          data.data = [];
        cb();
      });
    }

    ], function(err, results) {
      if (err) console.error(err);
      res.write(JSON.stringify(data));
      res.end();
    })

};



/*
  Fetch data from DB
*/
var getData = function(req, res){

  // TODO: error handling for invalid calls
  var action = req.body.action.toLowerCase();
  var limit = req.body.limit

  if (action in DATA_ACTIONS) {
    if (isNaN(limit))
      var lim = MAX_ENTRIES;
    else
      var lim = parseInt(limit);

    DATA_ACTIONS[action](lim, res);

  } else {

    console.error("Invalid Request: " + action)
    res.status(400).send();
  }

};

/*
  temporary blockstats here
*/
var latestBlock = function(req, res) {
  var block = Block.findOne({}, "totalDifficulty")
                      .lean(true).sort('-number');
  block.exec(function (err, doc) {
    res.write(JSON.stringify(doc));
    res.end();
  });
}


var getLatest = function(lim, res, callback) {
  var blockFind = Block.find({}, "number transactions timestamp miner extraData")
                      .lean(true).sort('-number').limit(lim);
  blockFind.exec(function (err, docs) {
    callback(docs, res);
  });
}

/* get blocks from db */
var sendBlocks = function(lim, res) {
  var blockFind = Block.find({}, "number transactions timestamp miner extraData")
                      .lean(true).sort('-number').limit(lim);
  blockFind.exec(function (err, docs) {
    res.write(JSON.stringify({"blocks": filters.filterBlocks(docs)}));
    res.end();
  });
}

var sendTxs = function (lim, res) {
  Transaction.find({}, "hash value blockNumber timestamp gas gasPrice input nonce from to type").lean(true).sort('-blockNumber').limit(lim)
    .exec(function (err, txs) {
      var filtered = filters.filterTX2(txs);
      var promises = filtered.map(function (tx) {
        return musicoinCore.getTransactionDetails(tx.hash)
          .catch(function (err) {
            console.log("Could not find details for transaction: " + tx.hash + ": " + err);
            return {err: err};
          })
      });
      Promise.all(promises)
        .then(function (results) {
          filtered.forEach(function (tx, i) {
            tx.details = results[i];
            if (tx.details.license) {
              tx.details.license.playableUrl = "/sample/" + tx.details.license.address;
              tx.image = tx.details.license.image;
            }
            if (tx.details.artistProfile && !tx.image) {
              tx.image = tx.details.artistProfile.image;
            }
          });
          res.write(JSON.stringify({"txs": filtered}));
          res.end();
        })
        .catch(function (err) {
          res.status(500);
          res.write(JSON.stringify(err));
          res.end();
          console.log(err);
        })
    });
};

const MAX_ENTRIES = 10;

const DATA_ACTIONS = {
  "latest_blocks": sendBlocks,
  "latest_txs": sendTxs
}
