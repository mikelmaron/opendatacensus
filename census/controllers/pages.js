'use strict';

var _ = require('underscore');
var marked = require('marked');
var models = require('../models');
var Promise = require('bluebird');


var overview = function (req, res) {

  models.utils.loadModels({

    entries: models.Entry.findAll(models.utils.siteQuery(req, true)),
    datasets: models.Dataset.findAll(models.utils.siteQuery(req)),
    places: models.Place.findAll(models.utils.siteQuery(req)), // TODO: sort places by score for year
    questions: models.Question.findAll(models.utils.siteQuery(req))

  }).then(function(D) {

    var openEntries = _.where(D.entries, {is_current: true}).length,
        byPlace = _.object(_.map(D.places, function(P) { return [P.id, {
          datasets: _.where(D.entries, {place: P.id}).length,
          score: 0
        }]; }));

    res.render('overview.html', {

      places: models.utils.translateSet(req, D.places),
      datasets: models.utils.translateSet(req, D.datasets),
      scoredQuestions: models.utils.translateSet(req, D.questions),
      summary: {
        entries: D.entries.length,
        open: openEntries,
        open_percent: openEntries / D.entries.length || 0,
        places: D.places.length
      },
      extraWidth: D.datasets.length > 12,
      byplace: byPlace,
      custom_text: req.params.site.settings.overview_page,
      missing_place_html: req.params.site.settings.missing_place_html
    });
  });
};


var faq = function (req, res) {

  var qTmpl = req.app.get('view_env').getTemplate('_snippets/questions.html');
  var dTmpl = req.app.get('view_env').getTemplate('_snippets/datasets.html');
  var gettext = res.locals.gettext;

  models.utils.loadModels({

    datasets: models.Dataset.findAll(models.utils.siteQuery(req)),
    questions: models.Question.findAll(models.utils.siteQuery(req))

  }).then(function(D) {

    var qContent = qTmpl.render({gettext: gettext, questions: D.questions});
    var dContent = dTmpl.render({gettext: gettext, datasets: D.datasets});
    var mContent = req.app.get('config').get('missing_place_html', req.locale);

    var content = marked(req.app.get('config').get('faq_page', req.locale))
      .replace('{{questions}}', qContent)
      .replace('{{datasets}}', dContent)
      .replace('{{missing_place}}', mContent);

    res.render('base.html', {
      content: content,
      title: 'FAQ - Frequently Asked Questions'
    });

  });
};

var changes = function (req, res) {
  models.Entry.findAll({
    where: {
      site: req.params.domain,
      year: req.app.get('year'),
      is_current: false
    },

    order: 'updated_at DESC'
  }).then(function(D) {
    res.render('changes.html', {changeitems: _.map(D, function(E) {
      var url;

      if (obj.reviewResult === 'accepted')
        url = '/entry/PLACE/DATASET'
          .replace('PLACE', E.place)
          .replace('DATASET', E.dataset);
      else
        url = E.detailsURL || '/submission/ID'.replace('ID', E.submissionid);

      return {
        type: type,
        timestamp: E.updated_at,
        dataset_title: E.dataset_title,
        place_name: E.place_name,
        url: url,
        status: E.reviewresult,
        submitter: E.submitter,
        reviewer: E.reviewer
      };
    })});
  });
};


var contribute = function (req, res) {

  var text = req.app.get('config').get('contribute_page', req.locale);
  var content = marked(text);

  res.render('base.html', {
    content: content,
    title: 'Contribute'
  });

};


var about = function (req, res) {
  var text = req.app.get('config').get('about_page', req.locale);
  var content = marked(text);
  res.render('base.html', {
    content: content,
    title: 'About'
  });
};


var resultJson = function (req, res) {

  var entries = req.app.get('models').Entry.findAll({
    where: {
      site: req.params.domain,
      year: req.app.get('year'),
      is_current: true
    }
  });

  entries.then(function(results){
    res.json(results);
  });

};

//Show details per country. Extra/different functionality for reviewers.
var place = function (req, res) {

  var place = models.Place.findOne({
    where: {
      id: req.params.place,
      site: req.params.domain
    }
  });

  // TODO: check this works
  place.then(function(result) {
    if (!result)
      return res.send(404, 'There is no place with ID ' + result.id + ' in our database. Are you sure you have spelled it correctly? Please check the <a href="/">overview page</a> for the list of places');

    var placeEntries;

    var placeSubmissions;

    // TODO: dataset.translated(req.locale) for each
    var placeDatasets;

    // TODO: question.translated(req.locale) for each
    var placeQuestions;

    // TODO: in final promise
    res.render('country/place.html', {
      info: placeEntries,
      datasets: placeDatasets,
      submissions: placeSubmissions,
      entrys: placeEntries, // TODO: ???? check this - what is different from info?
      place: _.result(_.result(result.translations, req.locale), 'name'),
      scoredQuestions: placeQuestions,
      loggedin: req.session.loggedin,
      display_year: req.app.get('year')
    });

  });

};

//Show details per dataset
var dataset = function (req, res) {

  function cleanResultSet(results) {
    var lookup = _.pluck(results, 'place'),
        redundants = findRedundants(lookup),
        clean_results = [];

    function sorter(a, b) {
      if (a.ycount > b.ycount)
        return -1;
      if (a.ycount < b.ycount)
        return 1;
      return 0;
    }

    function findRedundants(lookup) {
      var _redundants = [];
      _.each(lookup, function (key) {
        var r;
        r = _.filter(lookup, function (x) {
          if (x === key) {
            return x
          }
        });
        if (r.length > 1) {
          _redundants.push(key);
        }
      });
      return _redundants;
    }

    function removeRedundants(results) {
      _.each(results, function (entry) {
        if (_.contains(redundants, entry.place) &&
            entry.year !== req.app.get('year')) {
          // dont want it!
        } else {
          clean_results.push(entry);
        }
      });
      return clean_results;
    }
    return removeRedundants(results).sort(sorter);
  }

  models.utils.loadModels({
    // TODO: for each: result.translated(req.locale)
    dataset: models.Dataset.findOne({where: {id: req.params.dataset, site: req.params.domain}}),

    entries: models.Entry.findAll({where: {dataset: req.params.dataset, site: req.params.domain}})
  }).then(function(D) {
    if (!D.dataset)
      return res.status(404).send('Dataset not found. Are you sure you have spelled it correctly?');

    // TODO: for each: result.translated(req.locale)
    var datasetQuestions;


    models.Place.findAll({where: {id: {in: D.entries.map(function(E) { return E.place; })}}}).then(function(PD) {
      // TODO: in final promise
      res.render('country/dataset.html', {
        bydataset: D.entries,
        placesById: _.object(PD.map(function(P) { return [P.id, P] })),
        scoredQuestions: datasetQuestions,
        dataset: D.dataset
      });
    });
  });

};


var entry = function (req, res) {

  // TODO: we could break old urls and lookup entries by uuid
  var entry = models.Entry.findOne({
    where: {
      site: req.params.domain,
      place: req.params.place,
      dataset: req.params.dataset,
      is_current: true
    }
  });

  entry.then(function(result) {
    if (!result) {
      return res.status(404).send(res.locals.format('There is no entry for %(place)s and %(dataset)s', {
        place: req.params.place,
        dataset: req.params.dataset
      }, req.locale));
    } else {

      // TODO: ynquestions = model.data.questions.slice(0, 9);
      // TODO: for each: result.translated(req.locale)
      var ynquestions;

      // TODO: for each: result.translated(req.locale)util.translateQuestions(model.data.questions, req.locale)
      var questions;

      // TODO: for each: result.translated(req.locale)
      var scoredQuestions;

      // TODO: for each: result.translated(req.locale)
      var datasets;

      // TODO: for each: result.translated(req.locale)
      var dataset;

      // TODO: for each: result.translated(req.locale)
      var place;

      res.render('country/entry.html', {
        ynquestions: ynquestions,
        questions: questions,
        scoredQuestions: scoredQuestions,
        datasets: datasets,
        dataset: dataset,
        place: place,
        prefill: entry
      });

    }
  });

}


module.exports = {
  overview: overview,
  faq: faq,
  about: about,
  contribute: contribute,
  changes: changes,
  resultJson: resultJson,
  place: place,
  dataset: dataset,
  entry: entry
}