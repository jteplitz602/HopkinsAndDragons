/*globals dragons _ io THREEx*/
(function(){
  "use strict";

  // functions
  var restoreMap, addPiece, addEnemy, main, handleKeyDown, handleKeyUp, startGame,
      setupPlayers, setupPlayer, scrollMap, handleFog,
      updatePhysics, handleInput, createMovementVector, ping, handlePing,
      handleServerUpdate, updateTimers, processServerUpdates, handleServerError,
      startDraggingAttack, dragAttack, stopDraggingAttack,
      handleCombatStart, handleAttackSelect, handleTargetSelect, handleFight, handleCombatJoin, handleCombatOver,
      endCombat,
      checkForCombat, checkForRevive, displayMessage,
      updateFrameRate, getEnemy,
      lerp, vLerp;

  // globals
  var canvas, fogCanvas, canvasContainer = {}, mapInfo = {}, mapPieces = [], socket,
      players = {}, yourGuy = null, keyboard, combatSession = null, enemies = [], combatOver = null,
      playersLoading = 0, active = false,
      draggingAttack = false, pendingMessages = [],
      // physics globals
      pdt = 0.001, pdte = new Date().getTime(),
      // network globals
      netLatency = 0.001, netPing = 0.001, lastPingTime, serverTime = 0, clientTime = 0, localTime, dt, dte,
      lastLocalTime = 0,
      serverUpdates = [], lastInputNum = null,
      updateTimes  = [];

  dragons.organizedMap = {};

  $(document).ready(function(){
    setInterval(ping, 1000); // begin tracking ping immediatly

    canvas = new dragons.canvas($("#map")[0]);
    mapInfo = {
      width: $("#map").width(),
      height: $("#map").height()
    };
    fogCanvas = $("<canvas id='fogCanvas' width='" + mapInfo.width + "' height='" + mapInfo.height + "'></canvas>");
    $("#canvasContainer").append(fogCanvas);
    fogCanvas = new dragons.fogCanvas(fogCanvas[0], mapInfo.width, mapInfo.height, dragons.globals.playerSight);
    if (!_.isUndefined(dragons.fog) && !_.isNull(dragons.fog)){
      var saveImage = new Image();
      saveImage.src = dragons.fog;
      saveImage.onload = function(){
        fogCanvas.loadFromSave(saveImage);
      };
    }

    canvasContainer = {
      width: $("#canvasContainer").width(),
      height: $("#canvasContainer").height(),
      scrollLeft: $("#canvasContainer").scrollLeft(),
      scrollTop: $("#canvasContainer").scrollTop()
    };
    restoreMap();
    keyboard = new THREEx.KeyboardState();

    $(document).on("mousemove", dragAttack);
    $("#attacks .attack").on("mousedown", startDraggingAttack);
    $("#attacks .attack").on("dragstart", function(e){ e.preventDefault() }); // prevent browser dragging from getting in the way
    $(document).on("mouseup", ".dragging", stopDraggingAttack);

    // combat events
    $("#combatModal .attack").on("click", handleAttackSelect);
    $("#combatModal").on("click", ".enemy", handleTargetSelect);

    socket = io.connect(window.location.protocol + "//" + window.location.host);

    socket.on("connect", function(){
      // attempt to join the game
      socket.emit("join", {gameId: dragons.gameId});
    });

    socket.on("connected", function(data){
      console.log("connected to game " +  data.gameId + " with " + (data.clientCount - 1) + " others"); });

    socket.on("start", function(data){
      localTime = data.time + netLatency;
      var inputNum = data.inputNums[dragons.your_id];
      if (!_.isNull(yourGuy)){
        yourGuy.lastRecievedInput = inputNum;
        yourGuy.lastHandledInput  = inputNum;
      } else {
        lastInputNum = inputNum;
      }

      active = true;
    });

    socket.on("ping", handlePing);
    socket.on("update", handleServerUpdate);
    socket.on("error", handleServerError);

    // combat socket events
    socket.on("combatStart", handleCombatStart);
    socket.on("fight", handleFight);
    socket.on("combatJoin", handleCombatJoin);
    socket.on("combatOver", handleCombatOver);

    setInterval(updateTimers, 4);
    setupPlayers();

    // ui stuff
    $(".attack").tooltip();
  });

  startDraggingAttack = function(e){
    if (!draggingAttack){
      draggingAttack = true;

      var piece = $(this).clone();
      piece.addClass("dragging");
      piece.attr("data-startX", $(this).offset().left);
      piece.attr("data-startY", $(this).offset().top);
      $("body").append(piece);

      dragAttack(e);
    }
  };

  dragAttack = function(e){
    if (draggingAttack){
      $(".dragging").css("top", e.pageY + "px");
      $(".dragging").css("left", e.pageX + "px");
    }
  };

  stopDraggingAttack = function(e){
    if (draggingAttack){
      var dragging = $(".dragging");
      if (dragons.utils.detectMouseOver($(".attack1"), e)){
        yourGuy.attacks[0] = dragging.attr("data-name");
        $("#playerBar .attack1").html("<img src='" + dragging.attr("src") + "' width='40px' height='40px' />");
        dragging.remove();
        socket.emit("equip", {attack1: dragging.attr("data-name")});
      } else if (dragons.utils.detectMouseOver($(".attack2"), e)){
        yourGuy.attacks[1] = dragging.attr("data-name");
        $("#playerBar .attack2").html("<img src='" + dragging.attr("src") + "' width='40px' height='40px' />");
        dragging.remove();
        socket.emit("equip", {attack2: dragging.attr("data-name")});
      } else {
        dragging.animate({
          left: dragging.attr("data-startX") + "px",
          top: dragging.attr("data-startY") + "px"
        }, {
          duration: 200,
          complete: function(){
            $(this).remove();
          }
        });
      }
      draggingAttack = false;
    }
  };

  checkForCombat = function(){
    if (combatSession !== null){ return }

    var combatEnemies = {}, fighting = false;
    for (var i = 0; i < enemies.length; i++){
      if ((enemies[i].x + (enemies[i].width / 2)) - (enemies[i].pullRadius * 2) < yourGuy.x + yourGuy.width &&
          (enemies[i].x + (enemies[i].width / 2)) + (enemies[i].pullRadius * 2) > yourGuy.x &&
          (enemies[i].y + (enemies[i].height / 2)) - (enemies[i].pullRadius * 2) < yourGuy.y + yourGuy.height &&
          (enemies[i].y + (enemies[i].height / 2)) + (enemies[i].pullRadius * 2) > yourGuy.y){
        combatEnemies[enemies[i]._id] = enemies[i];
        fighting = true;
      }
    }

    if (fighting){
      var combatPlayers = {};
      combatPlayers[yourGuy._id] = yourGuy;
      var combat = new dragons.combat(combatEnemies, combatPlayers, yourGuy._id);
      active = false;
      combat.start();
      combatSession = combat;
    }
  };

  startGame = function(){
    setInterval(updatePhysics, dragons.globals.physicsUpdateTime);

    main();
  };

  updateTimers = function(){
    dt         = new Date().getTime() - dte;
    dte        = new Date().getTime();
    localTime += dt/1000.0;
  };

  updatePhysics = function(){
    // update delta time
    pdt = (new Date().getTime() - pdte)/1000.0;
    pdte = new Date().getTime();
    canvas.update();
    checkForCombat();
    checkForRevive();
  };

  handleServerUpdate = function(state){
    this.serverTime = state.time;
    this.clientTime = this.serverTime - (dragons.globals.netOffset / 1000);
    
    serverUpdates.push(state);
    
    // remove server updates that are too old TODO: this niumber isn't quite right
    if (serverUpdates.length >= (60 * dragons.globals.bufferSize)){
      serverUpdates.splice(0, 1);
    }

    // TODO correct client prediction
  };

  processServerUpdates = function(){
    if (serverUpdates.length === 0){
      return;
    }
    var i;
    // find the oldest update unprocessed update
    var count = serverUpdates.length - 1;

    var target   = null;
    var previous = null;

    for (i = 0; i < count; i++){
      var point      = serverUpdates[i];
      var next_point = serverUpdates[i+1];

      //Compare our point in time with the server times we have
      if(localTime > point.time && localTime < next_point.time) {
        target   = next_point;
        previous = point;
        break;
      }
    }
    
    if (_.isNull(target)){
      // with no target we move to the last known positon
      target   = serverUpdates[serverUpdates.length - 1];
      previous = serverUpdates[serverUpdates.length - 1];
    }

    if (target && previous){ // proabably redundent
       var targetTime     = target.time;

       var difference     = targetTime - localTime;
       var max_difference = (targetTime - previous.time);
       var time_point     = (difference/max_difference);

       // I guess target and previous can be equal if you have a super aweseome ping...
       if(_.isNaN(time_point) ){
         time_point = 0;
       }
       if(time_point === -Infinity){
         time_point = 0;
       }
       if(time_point === Infinity){
         time_point = 0;
       }
       time_point = time_point.fixed(3);

       var latestServerUpdate = serverUpdates[serverUpdates.length - 1];

       for (var player in target.pos){
         if (target.pos.hasOwnProperty(player)){
           if (players[player]._id === dragons.your_id){
             // TODO smoothly correct our own position
             continue; // For now we don't change ourselves
           }
          
           var currentPosition = {x: players[player].x, y: players[player].y};
           var newPosition     = vLerp(currentPosition, target.pos[player], pdt * dragons.globals.clientSmooth);
           if (players[player].x !== newPosition.x || players[player].y !== newPosition.y){
             players[player].movements.push({x: newPosition.x, y: newPosition.y});
           }
           players[player].x = newPosition.x;
           players[player].y = newPosition.y;
         }
       }
    }
  };

  setupPlayers = function(){
    for (var i = 0; i < dragons.players.length; i++){
      var playerImage = new Image();
      playerImage.onload = setupPlayer(playerImage, dragons.players[i]);
      playerImage.src = dragons.players[i].image;
      playersLoading++;
    }
  };

  setupPlayer = function(image, playerInfo){
    return function(){
      var player = new dragons.gameElements.Player(image, 50, 50, playerInfo.x, playerInfo.y, playerInfo.name, playerInfo._id);
      player.attacks = (_.has(playerInfo, "attacks")) ? playerInfo.attacks : [];
      player.health  = playerInfo.health;
      playersLoading--;
      canvas.addElement(player);
      players[playerInfo._id] = canvas.elements[canvas.elements.length - 1];

      if (player._id === dragons.your_id){
        yourGuy = player;
        $("#playerBar .name").text(player.name);
        for (var i = 0; i < ((player.attacks.length < 2) ? player.attacks.length : 2); i++){
          $("#playerBar .attack" + (i + 1)).html("<img src='" + dragons.attacks[player.attacks[i]].icon + "' width='40px' height='40px' + />");
        }
        if (!_.isNull(lastInputNum)){
          yourGuy.lastRecievedInput = lastInputNum;
          yourGuy.lastHandledInput  = lastInputNum;
        }
      }
      if (playersLoading === 0){
        startGame();
      }
    };
  };

  // stores inputs as they come in. Will also send them to the server immediatly
  handleInput = function(){
    if (!active){ return }

    if (yourGuy.health <= 0){
      // dead people can't move
      return;
    }

    var dx  = 0, dy = 0;
    var inputs = [];
    if (keyboard.pressed("left")){
      dx = -1;
      inputs.push("l");
    }
    if (keyboard.pressed("right")){
      dx = 1;
      inputs.push("r");
    }
    if (keyboard.pressed("up")){
      dy = -1;
      inputs.push("u");
    }
    if (keyboard.pressed("down")){
      dy = 1;
      inputs.push("d");
    }
    if (inputs.length > 0){
      yourGuy.inputs.push({
        inputs: inputs,
        seq: yourGuy.lastRecievedInput,
        time: localTime
      });

      socket.emit("input", {
        inputs: inputs,
        time: localTime,
        seq: yourGuy.lastRecievedInput
      });
      yourGuy.lastRecievedInput++;
    }
  };

  main = function(){
    updateTimes.push(localTime - lastLocalTime);
    lastLocalTime = localTime;
    if (updateTimes.length === 10){
      updateFrameRate();
      updateTimes.splice(0);
    }
    handleInput();
    processServerUpdates();
    handleFog();
    var oldX = yourGuy.x, oldY = yourGuy.y;
    canvas.draw();
    scrollMap(yourGuy.movements);

    /*if (yourGuy.movements.length > 0){
      var x = "", y = "";
      if (yourGuy.x > oldX){
        x = "left";
      } else if (yourGuy.x < oldX){
        x = "right";
      }

      if (yourGuy.y > oldY){
        y = "
      }
    }*/

    //sync();
    window.requestAnimationFrame(main.bind(this), $("#map")[0]);
  };

  // combat
  handleCombatStart = function(data){
    if (combatSession === null){
      checkForCombat();
    }
    var combatPlayers = {}, combatEnemies = {}, i;
    // get the full enemy and player information from the ids
    for (var player in data.players){
      if (data.players.hasOwnProperty(player)){
        players[player].health = data.players[player].health;
        combatPlayers[player] = players[player];
      }
    }

    for (var enemy in data.enemies){
      if (data.enemies.hasOwnProperty(enemy)){
        // enemies array really should be object
        for (i = 0; i < enemies.length; i++){
          if (enemies[i]._id === enemy){
            enemies[i].health = data.enemies[enemy].health;
            combatEnemies[enemy] = enemies[i];
          }
        }
      }
    }
    combatSession.players = combatPlayers;
    combatSession.enemies = combatEnemies;
    combatSession.setupUI();

    combatSession.start();
  };

  handleCombatOver = function(data){
    if (pendingMessages.length !== 0){
      combatOver = data;
    } else {
      endCombat(data);
    }
  };

  endCombat = function(data){
    // first update all the healths to the latest values
    for (var player in data.players){
      if (data.players.hasOwnProperty(player)){
        players[player].health = data.players[player].health;
      }
    }

    for (var enemy in data.enemies){
      if (data.enemies.hasOwnProperty(enemy)){
        // enemies array really should be object
        for (var i = 0; i < enemies.length; i++){
          if (enemies[i]._id === enemy){
            enemies[i].health = data.enemies[enemy].health;
          }
        }
      }
    }
    
    combatSession.end();
    combatSession = null;
    combatOver    = null;

    if (yourGuy.health <= 0){
      // you're dead :(
      $("#messageOverlay .message").text("You have been defeated. Any player that is not in combat may walk over to you to revive you.");
      $("#messageOverlay").show();
    }
  };

  handleFight = function(data){
    // display the messages
    pendingMessages = data.messages;
    displayMessage();

    // update player and enemy info
  };

  // displays the latest pending message and recalls itself if another is needed
  displayMessage = function(){
    if (pendingMessages.length === 0){
      if (combatOver !== null){
        // combat is over
        return endCombat(combatOver);
      }
      // no message. Go to next round
      combatSession.reset();
      return;
    }

    var displayOffset = 1500; // message offset in milliseconds

    var message = pendingMessages[0];
    $("#combatModal .messages").text(message.msg);

    // update player and enemy health
    if (_.has(message, "playerHealth")){
      for (var player in message.playerHealth){
        if (message.playerHealth.hasOwnProperty(player)){
          combatSession.players[player].health = message.playerHealth[player];
        }
      }
    }

    if (_.has(message, "enemyHealth")){
      for (var enemy in message.enemyHealth){
        if (message.enemyHealth.hasOwnProperty(enemy)){
          combatSession.enemies[enemy].health = message.enemyHealth[enemy];

          if (message.enemyHealth[enemy] <= 0){
            // remove this enemy from the map because it's dead
            canvas.removeElement(enemy);
            for (var i = 0; i < enemies.length; i++){
              if (enemies[i]._id === enemy){
                enemies.splice(i, 1);
                break;
              }
            }
          }
        }
      }
    }

    if (_.has(message, "setup") && message.setup){
      // resetup the UI
      combatSession.setupUI();
    }
    combatSession.refresh(); // refresh the combat UI
    pendingMessages.splice(0, 1);

    setTimeout(displayMessage, displayOffset);
  };

  handleCombatJoin = function(data){
    // figure out which enemies are new if any
    var newEnemies = "";
    combatSession.addPlayer(players[data.player]);

    for (var i = 0; i < data.combat.enemies.length; i++){
      if (_.has(combatSession.enemies, data.combat.enemies[i])){
        continue;
      }
      var thisEnemy = getEnemy(data.combat.enemies[i]);

      // this is a new enemy
      if (newEnemies !== ""){
        newEnemies += ", a " + thisEnemy.name;
      } else {
        newEnemies = "a " + thisEnemy.name;
      }
      combatSession.enemies[data.combat.enemies[i]] = thisEnemy;
    }
    var message = players[data.player].name + " has joined the fight.";
    if (newEnemies !== ""){
      message += " He has brought with him " + newEnemies + ".";
    }
    var messageNum = pendingMessages.length;
    pendingMessages.push({msg: message, setup: true});

    if (messageNum === 0){
      displayMessage();
    }
  };

  // really should have made enemies an object
  getEnemy = function(id){
    for (var i = 0; i < enemies.length; i++){
      if (String(enemies[i]._id) === String(id)){
        return enemies[i];
      }
    }
    return null;
  };

  handleAttackSelect = function(e){
    var targetNum = ($(this).hasClass("attack1")) ? 0 : 1;
    if (yourGuy.attacks.length + 1 < targetNum){ return } // not a valid selection
    
    if (yourGuy.health <= 0){ return } // can't attack if dead

    if (combatSession.state !== "attack"){ return } // only select the attack if that's the stage we're in

    $(this).addClass("selected");
    combatSession.state = "target";
  };

  handleTargetSelect = function(e){
    if (combatSession.state !== "target"){ return } // only select the enemy if that's the stage we're in
    var target = $(this).attr("data-id");

    // find the enemy
    if (getEnemy(target).health <= 0){ return } // can't attack a dead enemy

    // find the attack we selected earlier
    var attacks = $("#combatModal .attack"), attackNum;
    for (var i = 0; i < attacks.length; i++){
      if ($(attacks[i]).hasClass("selected")){
        attackNum = ($(attacks[i]).hasClass("attack1")) ? 0 : 1;
        break;
      }
    }
    combatSession.attack(yourGuy._id, attackNum, target);
    $(this).addClass("selected");
    combatSession.state = "waiting";
    socket.emit("attack", {num: attackNum, target: target}); // tell the server they selected this one
    $("#combatModal .messages").text("Waiting for other players.");
  };

  handleFog = function(){
    for (var player in players){
      if (players.hasOwnProperty(player)){
        fogCanvas.updateFog(players[player]);
      }
    }
  };

  scrollMap = function(direction){
    if (yourGuy.x + yourGuy.width >= canvasContainer.width + canvasContainer.scrollLeft){
      canvasContainer.scrollLeft += 200;
      $("#canvasContainer").animate({scrollLeft: canvasContainer.scrollLeft}, 200);
    } else if (yourGuy.x <= canvasContainer.scrollLeft){
      if (canvasContainer.scrollLeft - 200 < 0){
        canvasContainer.scrollLeft = 0;
      } else {
        canvasContainer.scrollLeft -= 200;
      }
      $("#canvasContainer").animate({scrollLeft: canvasContainer.scrollLeft}, 200);
    }

    if (yourGuy.y + yourGuy.height >= canvasContainer.height + canvasContainer.scrollTop){
      canvasContainer.scrollTop += 200;
      $("#canvasContainer").animate({scrollTop: canvasContainer.scrollTop}, 200);
    } else if (yourGuy.y < canvasContainer.scrollTop){
      if (canvasContainer.scrollTop - 200 < 0){
        canvasContainer.scrollTop = 0;
      } else {
        canvasContainer.scrollTop -= 200;
      }
      $("#canvasContainer").animate({scrollTop: canvasContainer.scrollTop}, 200);
    }
  };

  checkForRevive = function(){
    if (yourGuy.health <= 0){
      for (var player in players){
        if (players.hasOwnProperty(player)){
          if (player._id !== yourGuy._id){
            var checkPlayer = players[player];
            if (checkPlayer.x + checkPlayer.width > yourGuy.x &&
                checkPlayer.x < yourGuy.x + yourGuy.width     &&
                checkPlayer.y + checkPlayer.height > yourGuy.y &&
                checkPlayer.y < yourGuy.y + yourGuy.height){
              $("#messageOverlay").hide();
              yourGuy.health = 50;
            }
          }
        }
      }
    }
  };

  // maybe place the following three functions in some other file? canvas.js? map.js...
  restoreMap = function(){
    var i;
    for (i = 0; i < dragons.map.length; i++){
      var pieceImage = new Image();
      pieceImage.onload = addPiece(pieceImage, dragons.map[i], dragons.map[i]._id);
      pieceImage.src = dragons.map[i].image;
    }

    for (i = 0; i < dragons.enemies.length; i++){
      var enemyImage    = new Image();
      enemyImage.onload = addEnemy(enemyImage, dragons.enemies[i], dragons.enemies[i]._id);
      enemyImage.src    = dragons.enemies[i].baseEnemy.image;
    }
  };
  // adds a loaded piece to the canvas
  addPiece = function(image, mapPiece, id){
    return function(){
      var piece = new dragons.RoomElement(image, dragons.globals.map.roomWidth * 2, dragons.globals.map.roomHeight * 2,
                                                 mapPiece.x * 2, mapPiece.y * 2, mapPiece.rotate, mapPiece.doorLeft, mapPiece.doorRight,
                                                 mapPiece.doorTop, mapPiece.doorBottom, id);
      canvas.addElement(piece);
      mapPieces.push(piece);
      dragons.utils.buildMap(mapPieces); // organize the map object for easier editing access
      canvas.setMap(dragons.organizedMap);
      return piece;
    };
  };

  // adds an enemy to the canvas
  addEnemy = function(image, enemyData, id){
    return function(){
      var enemy = new dragons.gameElements.Enemy(image, 50, 50, enemyData.x * 2, enemyData.y * 2, enemyData.pullRadius, enemyData._id);
      enemy.gameData = enemyData;
      canvas.addElement(enemy);
      enemies.push(enemy);
      return enemy;
    };
  };

  ping = function(){
    lastPingTime = new Date().getTime() - dragons.globals.fakeLag;
    socket.emit("ping", {time: lastPingTime});
  };

  handlePing = function(data){
    netPing    = new Date().getTime() - parseFloat(data.time, 10);
    netLatency = netPing / 2;
    $("#ping").text("Ping: " + netPing + " m.s.");
  };

  updateFrameRate = function(){
    var sum = 0;
    for (var i = 0; i < updateTimes.length; i++){
      sum += updateTimes[i];
    }
    sum /= i;
    $("#frameRate").text((1 / sum) + " FPS");
  };

  // for now just alert the error
  handleServerError = function(err){
    console.log("error", err);
    alert(err.msg);
  };

  //Simple linear interpolation
  lerp = function(p, n, t) { var _t = Number(t); _t = (Math.max(0, Math.min(1, _t))).fixed(); return (p + _t * (n - p)).fixed(); };
  //Simple linear interpolation between 2 vectors
  vLerp = function(v,tv,t) { return { x: lerp(v.x, tv.x, t), y: lerp(v.y, tv.y, t) }; };
  Number.prototype.fixed = function(n) { n = n || 3; return parseFloat(this.toFixed(n)); }; // I don't love doing this...
}());
