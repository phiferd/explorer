$(document).ready(function(){
    $('[data-toggle="tooltip"]').tooltip();
});

playItem = function() {
  var player = $('#audioPlayer')[0];
  player.src = event.srcElement.getAttribute('license');
  player.load();
};