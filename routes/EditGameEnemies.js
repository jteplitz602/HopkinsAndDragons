(function(){
  "use strict";

  var _ = require("underscore"),
                    handleGet,
                    handlePost,
                    handlePut,
                    handleDelete,
                    handler, dispatch,
                    enemySaved,

          ControllerClass = require("../controllers/EditGameEnemies.js");

  handleGet = function(req, res, next){
    var control = new ControllerClass(req.session.user, req.params.id, req._schemas);

    var params = {};
    control.renderView(res, params);
  };

  handlePost = function(req, res, next){
    
  };

  handlePut = function(req, res, next){
    var control = new ControllerClass(req.session.user, req.params.id, req._schemas);
    var enemy = {
      x: (_.has(req.body, "x")) ? req.body.x : null,
      y: (_.has(req.body, "y")) ? req.body.y : null,
      pullRadius: (_.has(req.body, "pullRadius")) ? req.body.pullRadius : null
    };

    if (_.has(req.body, "_id")){
       control.editEnemy(req.body._id, enemy, enemySaved(res, next));
    } else {
      enemy.baseEnemy = (_.has(req.body, "baseEnemy")) ? req.body.baseEnemy : null;
      control.createEnemy(enemy, enemySaved(res, next));
    }
  };

  enemySaved = function(res, next){
    return function(err, enemy){
      if (err){ return next(500) }

      res.json({
        enemy: enemy,
        error: 0
      });
    };
  };

  handleDelete = function(req, res, next){
    var control = new ControllerClass(req.session.user, req.params.id, req._schemas);
    if (!_.has(req.body, "_id")){
      return res.json(400, {
        err: 400,
        msg: "_id required to delete an enemy"
      });
    }

    control.deleteEnemy(req.body._id, function(err){
      if (err){
        return res.json(500, {
          err: 500,
          msg: "Unable to process request at this time"
        });
      }

      return res.json({
        err: 0
      });
    });
  };
  
  dispatch = {GET: handleGet, POST: handlePost, PUT: handlePut, DELETE: handleDelete};
  handler = function(req, res, next){
    if (_.has(dispatch, req.method)){
      return dispatch[req.method](req, res, next);
    }

    return next(405);
  };
  
  module.exports = handler;
}());
