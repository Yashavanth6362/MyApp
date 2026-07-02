document.addEventListener("deviceready", function () {
    console.log("Cordova Ready");

    if (typeof Weather !== "undefined") {
        Weather.render("#app");
    }
});

document.addEventListener("DOMContentLoaded", function () {
    console.log("HTML Loaded");
});