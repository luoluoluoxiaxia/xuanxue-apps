"use strict";

// All zero-build workspace feature fragments are loaded before this handoff.
void init()
  .then(() => { document.documentElement.dataset.appReady = "true"; })
  .catch(error => {
    document.documentElement.dataset.appReady = "error";
    throw error;
  });
