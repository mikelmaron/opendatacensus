'use strict';

var _ = require('lodash');


var loadModels = function(querysets) {

  return Promise.all(_.map(querysets, function(V, K) {
    return new Promise(function(RS, RJ) { V.then(function(D) { RS([K, D]); }); });
  })).then(function(V) { return _.object(V); });

};


var siteQuery = function(req, byYear) {

  var whereParams = {
    site: req.params.domain
  };

  if (byYear && req.params.year) {
    whereParams.year = req.params.year;
  }

  return {where: whereParams};

};


var translateSet = function(req, results) {

  _.each(results, function(result, index, list) {
    list[index] = result.translated(req.locale);
  });

  return results;

};


module.exports = {
  loadModels: loadModels,
  siteQuery: siteQuery,
  translateSet: translateSet
};