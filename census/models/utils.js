'use strict';

var _ = require('lodash');


var loadModels = function(querysets, options) {
  return Promise.all(_.map(querysets, function(V, K) {
    return new Promise(function(RS, RJ) { V.then(function(D) { RS([K, D]); }); });
  })).then(function(V) { return {data: _.object(V), options: options}; });
};


var siteQuery = function(domain, year, byYear) {
  var whereParams = {site: domain};
  if (byYear && year) { whereParams.year = year; }
  return {where: whereParams};
};


var translateSet = function(locale, results) {
  _.each(results, function(result, index, list) {
    list[index] = result.translated(locale);
  });
  return results;
};


/**
 * Query the database for data.
 * if options.ynQuestions, then only get yn
 * options.models has models
 * options.with.{MODELNAME} to control queries actually made. can be done better.
 */
var queryData = function(options) {

  var entryParams = _.merge(siteQuery(options.domain, options.year, !options.cascade),
                            {
                              order: '"updatedAt" DESC',
                              include: [
                                {model: options.models.User, as: 'Submitter'},
                                {model: options.models.User, as: 'Reviewer'}
                              ]
                            }),
      datasetParams = _.merge(siteQuery(options.domain), {order: '"order" ASC'}),
      placeParams = _.merge(siteQuery(options.domain), {order: 'id ASC'}),
      questionParams = _.merge(siteQuery(options.domain), {order: 'score DESC'}),
      querysets = {};

  if (options.ynQuestions) { questionParams =  _.merge(questionParams, {where: {type: ''}}); }

  // prep the querysets object
  if (options.place) {
    placeParams = _.merge(placeParams, {where: {id: options.place}});
    entryParams = _.merge(entryParams, {where: {place: options.place}});
    if (options.with.Place) { querysets.place = options.models.Place.findOne(placeParams); }
  } else {
    if (options.with.Place) { querysets.places = options.models.Place.findAll(placeParams); }
  }

  if (options.dataset) {
    datasetParams = _.merge(datasetParams, {where: {id: options.dataset}});
    entryParams = _.merge(entryParams, {where: {dataset: options.dataset}});
    if (options.with.Dataset) { querysets.dataset = options.models.Dataset.findOne(datasetParams); }
  } else {
    if (options.with.Dataset) { querysets.datasets = options.models.Dataset.findAll(datasetParams); }
  }

  if (options.with.Entry) { querysets.entries = options.models.Entry.findAll(entryParams); }
  if (options.with.Question) { querysets.questions = options.models.Question.findAll(questionParams); }

  return loadModels(querysets, options);
};

/**
 * Process all data for stats.
 */
var processStats = function(data, options) {
  data.stats = {};

  if (Array.isArray(data.entries)) {
    data.stats.currentEntryCount = data.entries.length;
    data.stats.currentEntryOpenCount = _.filter(data.entries, function(e) { return e.isOpen() === true; }).length;
    data.stats.openDataPercent = parseInt((data.stats.currentEntryOpenCount / data.stats.currentEntryCount) * 100, 10);
  } else {
    data.stats.currentEntryCount = 0;
    data.stats.currentEntryOpenCount = 0;
    data.stats.openDataPercentCount = 0;
  }

  if (Array.isArray(data.places)) {
    data.stats.placeCount = data.places.length;
  } else {
    data.stats.placeCount = 0;
  }

  return data;
};


var cascadeEntries = function(entries, currentYear) {
  var cascaded = [];
  var grouped = _.groupBy(entries, function(e) { return e.place + '/' + e.dataset; });
  _.each(grouped, function(value) {
    var match, matches = [], candidates;
    if (value) {
      candidates = _.sortByOrder(value, ['year', 'updatedAt'], 'desc');
      match = _.find(candidates, {'isCurrent': true});
      if (match) { matches.push(match); }
      matches = matches.concat(_.filter(candidates, {'isCurrent': false, 'year': currentYear}) || []);
      cascaded = cascaded.concat(matches);
    }
  });
  return cascaded;
};


var setEntryUrl = function(entry) {
  if (entry.isCurrent) {
    return '/entry/PLACE/DATASET'
      .replace('PLACE', entry.place)
      .replace('DATASET', entry.dataset);
  } else {
    return '/submission/ID'.replace('ID', entry.id);
  }
};

/**
 * Process the raw entries query.
 */
var processEntries = function(data, options) {
  if (Array.isArray(data.entries)) {
    data.reviewers = [];
    data.submitters = [];

    if (options.cascade) { data.entries = cascadeEntries(data.entries, options.year); }
    data.pending = _.where(data.entries, {'isCurrent': false, 'reviewed': false});
    data.rejected = _.where(data.entries, {'isCurrent': false, 'reviewed': true, 'reviewResult': false});
    _.remove(data.entries, function(e) { return e.isCurrent === false; });

    _.each(data.entries, function(e) {
      e.computedYCount = e.yCount(data.questions);
      e.url = setEntryUrl(e);
      data.reviewers.push(e.Reviewer);
      data.submitters.push(e.Submitter);
    });

    data.reviewers = _.uniq(data.reviewers, 'id');
    data.submitters = _.uniq(data.submitters, 'id');
  }
  return data;
};

/**
 * Process the raw places query.
 */
var processPlaces = function(data, options) {
  if (data.place) {
    data.place = data.place.translated(options.locale);
  } else {
    if (Array.isArray(data.entries)) {
      _.each(data.places, function(p) {
        p.computedScore = p.score(data.entries, data.questions);
      });
      data.places = rankPlaces(_.sortByOrder(translateSet(options.locale, data.places), 'computedScore', 'desc'));
    }
  }
  return data;
};

/**
 * Process the raw datasets query.
 */
var processDatasets = function(data, options) {

  if (data.dataset) {
    data.dataset = data.dataset.translated(options.locale);
  } else {
    data.datasets = translateSet(options.locale, data.datasets);
  }

  return data;
};

/**
 * Process the raw questions query.
 */
var processQuestions = function(data, options) {
  data.questions = translateSet(options.locale, data.questions);
  return data;
};

/**
 * Process the raw query data.
 */
var processData = function (result) {
  var data = result.data,
      options = result.options;
  if (data.entries) { data = processEntries(data, options); }
  if (data.places || data.place) { data = processPlaces(data, options); }
  if (data.datasets || data.dataset) { data = processDatasets(data, options); }
  if (data.questions) { data = processQuestions(data, options); }
  data = processStats(data, options);
  return data;
};

/**
 * The interface to get data, all clean and ready like.
 */
var getData = function(options) {
  return queryData(options).then(processData);
};

/**
 * Do leaderboard ranking on places by computedScore. Places MUST be ordered
 * by descending score. Tied places have equal rank.
 */
var rankPlaces = function(places) {
  var lastScore = null,
      lastRank = 0;

  _.each(places, function(p, i) {
    if (lastScore === p.computedScore) {
      p.rank = lastRank;
    } else {
      p.rank = i+1;
    }
    lastRank = p.rank;
    lastScore = p.computedScore;
  });

  return places;
};


var getDataOptions = function(req) {
  return {
    models: req.app.get('models'),
    domain: req.params.domain,
    dataset: req.params.dataset,
    place: req.params.place,
    year: req.params.year,
    cascade: req.params.cascade,
    ynQuestions: true,
    locale: req.params.locale,
    with: {Entry: true, Dataset: true, Place: true, Question: true}
  };
};


module.exports = {
  loadModels: loadModels,
  siteQuery: siteQuery,
  translateSet: translateSet,
  cascadeEntries: cascadeEntries,
  getDataOptions: getDataOptions,
  getData: getData
};
