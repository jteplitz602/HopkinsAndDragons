(function(){
  "use strict";

  var base = require("./base.js"),
      ViewClass = require("../views/Games.js"),

      _ = require("underscore"),

      GamesCtrl, _ptype;

  GamesCtrl = function(schemas, user){
    this.schemas = schemas;
    this.user    = user;

    this.payload = {title: "Your Games"};
    this._view   = new ViewClass();
  };

  _ptype = GamesCtrl.prototype = base.getProto("std");
  _ptype._name = "Games";

  _ptype.prePrep = function(data, cb){
    var query = this.schemas.Game.find();
    query.or([
      {"players.owner": this.user._id},
      {owner: this.user._id}
    ]);
    query.exec(function(err, results){
      if (err){ return cb(err) }
      if (_.isNull(results) || _.isUndefined(results)){
        results = [];
      }

      data.games = results;
      cb();
    });
  };

  // TODO: game _id's should be monotonic numbers
  _ptype.createGame = function(gameData, cb){
    console.log("saving game", this.user);
    var game = new this.schemas.Game({
      name: gameData.name,
      players: gameData.owners,
      enemies: [],
      story: [],
      map: [],
      fog: "",
      backgroundStory: "",
      endStory: "",
      owner: this.user._id
    });

    game.save(cb);
  };

  module.exports = GamesCtrl;
}());
