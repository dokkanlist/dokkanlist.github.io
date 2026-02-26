// loads a count of icons in each folder from the pre-generated JSON file
let iconCounts = { lr: 182, dfe: 139 }; // Default fallback values - automatically updated by nodeJS

async function loadIconCounts() {
  try {
    const response = await fetch('./js/iconCounts.json');
    if (!response.ok) throw new Error('Could not load iconCounts.json');

    const data = await response.json();
    iconCounts = { lr: data.lr, dfe: data.dfe };

    console.log('Loaded icon counts:', iconCounts);
    console.log(`   Generated: ${new Date(data.generated).toLocaleString()}`);

    return iconCounts;
  } catch (error) {
    console.warn('Using fallback icon counts:', error.message);
    return iconCounts; // Return defaults
  }
}

// helper function for parsing ranges in arrays
function parseRanges(rangeString) {
  const result = [];
  const parts = rangeString.split(',').map(s => s.trim());

  parts.forEach(part => {
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(Number);
      for (let i = start; i <= end; i++) {
        result.push(i);
      }
    } else if (part) { // Skip empty strings
      result.push(Number(part));
    }
  });

  return result;
}

// Ensure button is loaded before adding event listener
document.addEventListener("DOMContentLoaded", async () => {
  // load counts before initialization
  await loadIconCounts();

  //global declarations
  let enter = document.getElementById('special');
  let changelogList = document.getElementById('changelog-item');
  $(".switch input").prop("checked", false);

  //target elements for animations
  const toggleButton = document.getElementById("toggleButton");
  const iconContainer = document.getElementById("icon-container");
  const header = document.getElementById("header");

  //event listening for clicks on toggle button
  toggleButton.addEventListener("click", function () {
    this.classList.add("flip");
    header.classList.add("flip");
    iconContainer.classList.add("glitch-blur");

    setTimeout(() => {
        toggleMode(); // Switch mode when halfway flipped
        this.classList.remove("flip"); // Complete the animation
        this.classList.add("flip-back"); // Finish rotation
        header.classList.remove("flip"); // Complete the animation
        header.classList.add("flip-back"); // Finish rotation
        iconContainer.classList.remove("glitch-blur");
    }, 150); // Wait for half of the animation time

    setTimeout(() => {
        this.classList.remove("flip-back"); // Reset so animation can happen again
        header.classList.remove("flip-back");
    }, 300);
});

  // loads last mode from localstorage otherwise default to LR
  let currentMode = localStorage.getItem("dokkanMode") || "lr";
  updateMode(currentMode, false);

  //toggle button handling
  function toggleMode() {
    let newMode = document.body.classList.contains("dfe") ? "lr" : "dfe";
    updateMode(newMode, true); // Save mode change
    $(".switch input").prop("checked", false);

    //coreFunctions must be below loadFlairs
    loadFlairs();
    coreFunctions();
  }

  //updating the page after a toggle
  function updateMode(mode, save = true) {
      if (!document.body) return; // Ensure body exists before modifying
      currentMode = mode;
      document.body.classList.remove("dfe", "lr"); // Clear existing classes
      document.body.classList.add(mode); // Apply new mode class

      //updates the page title
      document.getElementById("title").innerText = mode === "dfe"
          ? "Dokkan Festival Exclusive Checklist"
          : "Dokkan LR Checklist";

      //update icon and button
      document.getElementById("favicon").href = mode === "dfe" ? "stone.ico" : "lr.ico";
      document.getElementById("toggleButton").innerHTML = mode === "dfe" ? "<div class='lr_switch'></div>" : "<div class='dfe_switch'></div>";

      if (save) {
          localStorage.setItem("dokkanMode", mode); // Save mode to localStorage
      }
      enter.innerHTML = "";
      changelogList.innerHTML = "";
  }

  //main icons handling
  loadFlairs = function() {
    // LR type arrays
    let lrAGL = parseRanges('2,7,12,16,24,34,38-40,46-47,51,60-61,72,87-88,92,98,101,107,118-119,121,124-125,130,135,141,144,155,157,160-161,167,175-176');
    let lrTEQ = parseRanges('1,9-10,17,20,29,36,42,44-45,53,57,64-65,70,79,82,93,95-96,100,106,110,113,126,129,131,140,143,146,150-151,153-154,171-172,180');
    let lrSTR = parseRanges('4,8,14,21-22,32-33,35,41,43,52,54,62,67,69,77,80,84-85,90,97,105,111,115,120,128,137,142,148,152,156,164-166,169,174,178-179');
    let lrPHY = parseRanges('5,11,15,19,23,27-28,31,49,56,59,63,66,68,71,74-75,83,91,94,99,108,112,114,127,133-134,136,145,149,158,162-163,168,182');
    let lrINT = parseRanges('3,6,13,18,25-26,30,37,48,50,55,58,73,76,78,81,86,89,102-104,109,116-117,122-123,132,138-139,147,159,170,173,177,181');

    // DFE type arrays
    let dfAGL = parseRanges('4,11,14,20,26,29,44,46,50,53,55,61,66,70,79,86,89,93,97,102,107,114,117,120,124,130,137,139');
    let dfTEQ = parseRanges('2,10,13,16,23,28,34-35,41,48,51,59-60,68,73,75,80,88,90,99,103,108,111,118,126,133,136');
    let dfSTR = parseRanges('1,5,9,17,21,25,32,37,42,45,52,62,65,71,74,78,83,87,92,96,101,105,113,115,123,125,131,135,138');
    let dfPHY = parseRanges('3,7,12,18-19,27,33,36,39,47,49,56,58,63,69,76,81,84,91,95,100,106,110,119,122,128-129,134');
    let dfINT = parseRanges('6,8,15,22,24,30-31,38,40,43,54,57,64,67,72,77,82,85,94,98,104,109,112,116,121,127,132');

    let lrEZA = parseRanges(`
      1-9, 10-19, 20-29, 30-38, 40-49, 50-59, 60-69, 70-76,78-80,
      82-89, 90-98, 101-102, 104, 109, 111-118, 136, 149
    `);
    let lrEZA2 = parseRanges('1,6-8,11,12,14,54,178');

    let dfEZA = parseRanges(`
      1-3, 5-9, 10-12, 14-19, 20-29, 30-39, 40-49, 50-59,
      60-69, 70-75, 77-79, 80-89, 90-93, 96-99, 100-102, 104
    `);
    let dfEZA2 = parseRanges('1-11, 13-15, 17-20, 24-26');

    //LR changelog items
    const LRupdateItems = [
      "INT SSJ4 Vegeta + Goku",
      "PHY UI + SSBE",
      "PHY SSJ3 Goku & SSJ2 Vegeta EZA",
      "STR GT Goku & SSJ4 Vegeta EZA"
    ]

    //DFE changelog items
    const DFEupdateItems = [
    "TEQ Pan EZA",
    "INT SSB Vegeta Super EZA",
    "INT RoF SSB Goku & Vegeta EZA"
    ]

     // Create icons dynamically
     // number format - LR : DFE
    let total = currentMode === "lr" ? iconCounts.lr : iconCounts.dfe
    let flaircheck = currentMode === "dfe" ? "b" : "";

    // MAIN FLAIR CREATION LOOP
    for (let i = 1; i <= total; i++) {
      let folder = currentMode === "dfe" ? "images/dfe" : "images/lr";

      const flairSpecial = document.createElement('div');
      flairSpecial.className = 'flair';
      flairSpecial.id = i+flaircheck;
      flairSpecial.style.backgroundImage = `url(../`+folder+`/icons/${i}.webp)`;
      enter.appendChild(flairSpecial);
    }

    // Assign EZA and SUPER EZA classes
    if (currentMode === "lr") {
      lrEZA.forEach(id => document.getElementById(id)?.classList.add('eza'));
      lrEZA2.forEach(id => document.getElementById(id)?.classList.add('eza2'));
    } else {
      dfEZA.forEach(id => document.getElementById(id+'b')?.classList.add('eza'));
      dfEZA2.forEach(id => document.getElementById(id+'b')?.classList.add('eza2'));
    }

    // Assign type glow classes
    if (currentMode === "lr") {
      lrAGL.forEach(id => document.getElementById(id)?.classList.add('type-agl'));
      lrTEQ.forEach(id => document.getElementById(id)?.classList.add('type-teq'));
      lrSTR.forEach(id => document.getElementById(id)?.classList.add('type-str'));
      lrPHY.forEach(id => document.getElementById(id)?.classList.add('type-phy'));
      lrINT.forEach(id => document.getElementById(id)?.classList.add('type-int'));
      lrEZA2.forEach(id => document.getElementById(id)?.classList.add('glow-pulse'));
    } else {
      dfAGL.forEach(id => document.getElementById(id+'b')?.classList.add('type-agl'));
      dfTEQ.forEach(id => document.getElementById(id+'b')?.classList.add('type-teq'));
      dfSTR.forEach(id => document.getElementById(id+'b')?.classList.add('type-str'));
      dfPHY.forEach(id => document.getElementById(id+'b')?.classList.add('type-phy'));
      dfINT.forEach(id => document.getElementById(id+'b')?.classList.add('type-int'));
      dfEZA2.forEach(id => document.getElementById(id+'b')?.classList.add('glow-pulse'));
    }

    // Add lightning overlay to Super EZA (glow-pulse) icons
    document.querySelectorAll('.flair.glow-pulse').forEach(el => {
      const type = ['agl','teq','str','phy','int'].find(t => el.classList.contains('type-' + t));
      if (!type) return;
      if (el.querySelector('.lightning-overlay')) return;

      // Capture the icon's background-image into a CSS variable
      // so ::after can display it (CSS will hide the original)
      const bg = el.style.backgroundImage || getComputedStyle(el).backgroundImage;
      el.style.setProperty('--flair-bg', bg);

      const overlay = document.createElement('div');
      overlay.className = `lightning-overlay lightning-${type}`;
      el.appendChild(overlay);
    });

    // Append changelog items
    const types = ["AGL", "INT", "STR", "TEQ", "PHY"];
    let updateItems = currentMode === "lr" ? LRupdateItems : DFEupdateItems;

    updateItems.forEach(item => {
      const listItem = document.createElement('li');
      let modifiedText = item;

      types.forEach(type => {
        const regex = new RegExp(`\\b${type}\\b`, 'g');
        modifiedText = modifiedText.replace(regex, `<span class="${type}">${type}</span>`);
      });

      listItem.innerHTML = modifiedText;
      changelogList.appendChild(listItem);
    });

    // Fetch the latest commit date from GitHub API
    const fetchLatestCommitDate = async () => {
      try {
        const response = await fetch('https://api.github.com/repos/dokkanlist/dokkanlist.github.io/commits');
        if (!response.ok) throw new Error('Failed to fetch commit data');
        const commits = await response.json();

        // Get the date of the latest commit
        const latestCommitDate = commits[0].commit.committer.date;
        const formattedDate = new Date(latestCommitDate).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        });

        // Update the changelog date dynamically
        document.querySelector('#changelog h3').textContent = `Last Update: ${formattedDate}`;
      } catch (error) {
        console.error('Error fetching the latest commit date:', error);
      }
    };

    // Call the function during initialization
    fetchLatestCommitDate();
  }

  //coreFunctions must be below loadFlairs
  loadFlairs();
  coreFunctions();

  // <----------------------------------------------------------------->

  // updates local storage values
  function updateStorage(key, value, save) {
    if (save) {
      localStorage.setItem(key, value);
    }
    else {
      localStorage.removeItem(key);
    }
  }

  // reads local storage based on key
  function readStorageValue(key) {
    return localStorage.getItem(key);
  }

  // reads entire local storage array
  function readAllStorage() {
    let nbItem = localStorage.length;
    let store = [];
    let i;
    let storeKey;
    for (i = 0; i < nbItem; i += 1) {
      storeKey = localStorage.key(i);
      store.push({
        "key" : storeKey,
        "value" : readStorageValue(storeKey)
      });
    }
    return store;
  }

  // reads storage and updates the page accordingly
  function updatePage() {
    //check local storage
    const store = readAllStorage();
    //restore the selected class
    $.each(store, function(index, elem) {
      if(elem['value'] == 'hidden')
        $("#" + elem.key).addClass("disabled");
      else if (elem['value'] == 'true'){
        $('.base').toggleClass('hidden');
        $('#hide-base').css('display', 'none');
        $('#show-base').css('display', 'inline-block');
      }
      else
        $("#" + elem.key).addClass("selected");
    });
  }

  // select all icons on page
  function selectPage() {
      //adds selected class to every icon
      $("#special .flair:not(.disabled)").addClass("selected");

    const className = document.getElementsByClassName('selected');
    let idStore = new Array();


    //loops every ID and stores key into array
    for(var i = 0; i < className.length; i++) {
      idStore.push({"key" : className[i].id, "value" : className[i].className});
    }

    //add IDs from array to local storage
    for(var j=0; j<idStore.length; j++) {
        updateStorage(idStore[j]['key'], null, true);
      }
  }

  // remove all selections on SELECTED page
  function resetPage() {
      const currentMode = localStorage.getItem("dokkanMode");
      Object.keys(localStorage).forEach(key => {
          // Skip non-icon keys
          const numericPart = key.replace(/b$/, '');
          if (isNaN(numericPart)) return;

          if ((currentMode === "lr" && !key.endsWith("b")) || (currentMode === "dfe" && key.endsWith("b"))) {
              localStorage.removeItem(key);
              $("#" + key).removeClass("selected disabled");
          }
      });
  }

  //total legend tracker
  function countLegends() {
    let rarity = currentMode === "lr" ? "LRs" : "DFEs";

    // Count only visible and selected icons
    const visibleSelected = $("#special .flair.selected").filter(function() {
      return $(this).css('display') !== 'none';
    }).length;

    // Count total visible icons (not disabled and not hidden by filter)
    const totalVisible = $("#special .flair").filter(function() {
      return !$(this).hasClass('disabled') && $(this).css('display') !== 'none';
    }).length;

    $('#counter').html("<span class='cl'>Total "+rarity+" - </span>" + visibleSelected + "/" + totalVisible);
  }

  //unhides specific Legends
  function listHidden() {
    let folder = currentMode === "dfe" ? "images/dfe" : "images/lr";

    toggleModal('removed-modal');
    $(".modal-content2").empty();
    $("#hide-lr").prop("checked", false);

    const disabled = $(".disabled");
    const box = $('.modal-content2');

    //creates new images for hidden legends
    for(var i = 0; i < disabled.length; i++) {
      const flair = document.createElement('img');
      flair.setAttribute('class', 'flair');
      flair.setAttribute('name', disabled[i].id);
      flair.setAttribute('src', folder+'/icons/'+disabled[i].id.replace(/b$/, '')+'.webp');

      box.append(flair);
    }

    //unhide legends in checklist when clicked
    $(".modal-content2 img").mousedown(function(e) {
      let $obj = $(this);
      let id = $obj[0].name;

      $("#"+id).removeClass('disabled');
      //removes from modal display
      $obj.hide();
      //removes from local storage
      localStorage.removeItem(id);
      //updates counters
      countLegends();
    });
  }

  //toggles popup window
  function toggleModal(e) {
    let modal = document.querySelector("#"+e);
    let closeBtn = document.querySelector("#"+e+" .close-btn")

    modal.style.visibility = "visible";
    modal.style.opacity = "100";

    closeBtn.onclick = function(){
      modal.style.visibility = "hidden";
      modal.style.opacity = "0";
      $('#import-text').val('');
    }
    window.onclick = function(e){
      if(e.target == modal){
        modal.style.visibility = "hidden";
        modal.style.opacity = "0";
        $('#import-text').val('');
      }
    }
  }

  function windowOnClick(event) {
    const modal = document.querySelector(".modal");
     if (event.target === modal) {
         toggleModal();
     }
  }

  // ═══ Image Export Helpers ═══
  //
  // Problem: ::after with var(--flair-bg) doesn't render in html-to-image.
  // Solution: Temporarily inject an <img> element inside .glow-pulse flairs
  // that sits above the lightning overlay (z-index: 1), replicating what
  // ::after does on the live page. Remove it after capture.

  function prepareForCapture() {
    document.querySelectorAll('.flair.glow-pulse').forEach(el => {
      const bg = el.style.getPropertyValue('--flair-bg');
      if (!bg) return;

      // Extract URL from the var value, e.g. url("...") or url(...)
      const urlMatch = bg.match(/url\(["']?(.+?)["']?\)/);
      if (!urlMatch) return;

      // Create an img element that covers the flair and sits above lightning
      const img = document.createElement('img');
      img.src = urlMatch[1];
      img.className = 'capture-icon-img';
      img.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 1;
        pointer-events: none;
        object-fit: contain;
      `;
      el.appendChild(img);
    });

    // Hide ::after (the img replaces it)
    document.documentElement.classList.add('capturing');
  }

  function restoreAfterCapture() {
    // Remove injected img elements
    document.querySelectorAll('.capture-icon-img').forEach(img => img.remove());

    // Restore ::after
    document.documentElement.classList.remove('capturing');
  }

  // ═══ Export Image Function ═══
  function generateImage() {
    toggleModal('image-modal');
    $(".modal-content").empty();

    const node = document.getElementById('icon-container');

    prepareForCapture();

    htmlToImage.toPng(node, {
      pixelRatio: 3,
      skipFonts: true,
      skipAutoScale: false,
      style: {
        transform: 'scale(1)',
        transformOrigin: 'top left'
      }
    })
    .then(function (dataUrl) {
      restoreAfterCapture();
      const img = new Image();
      img.src = dataUrl;
      img.style.width = node.offsetWidth + "px";
      img.style.height = node.offsetHeight + "px";
      $(".modal-content").append(img);
    })
    .catch(function (error) {
      restoreAfterCapture();
      console.error('Image generation failed:', error);
    });
  }

  // ═══ Download Function ═══
  function download() {
    const node = document.getElementById('icon-container');

    prepareForCapture();

    htmlToImage.toBlob(node, {
      pixelRatio: 3,
      skipFonts: true,
      filter: (node) => {
        return !(node.tagName === 'LINK' && node.href && node.href.startsWith('moz-extension://'));
      }
    })
    .then(function (blob) {
      restoreAfterCapture();
      if (blob) {
        window.saveAs(blob, 'checklist.png');
      } else {
        console.error("Image blob generation failed.");
      }
    })
    .catch(function (error) {
      restoreAfterCapture();
      console.error('Download failed:', error);
    });
  }

  //export localStorage
  function exportSelection() {
    let raw = JSON.stringify(localStorage);
    container = document.getElementById("export-text");
    container.setAttribute("style", "transform: translateY(0); opacity: 1; z-index: 1;");
    container.value = LZString.compressToEncodedURIComponent(raw);
  }

  //copy exported data
  function copySelection() {
    container = document.getElementById("export-text");
    container.select();
    document.execCommand("copy");
    $('#display-copied').fadeIn().delay(1000).fadeOut();
  }

  //apply imported data
  function importSelection() {
    let text = document.getElementById("import-text").value;

    plaintext = LZString.decompressFromEncodedURIComponent(text);

    //clears local storage
    localStorage.clear();

    try {
      // Convert to a JSON object
      data = JSON.parse(plaintext);

      console.log(data);

      // Iterate over the JSON object and save to localstorage
      Object.keys(data).map(function(key, index) {
          const value = data[key];
          localStorage.setItem(key, value);
      });

      $('#imported').fadeIn().delay(1000).fadeOut();
    }
    //if error
    catch {
      $('#undefined').fadeIn().delay(1000).fadeOut();
    }

    coreFunctions();
  }

  function coreFunctions() {
    //restore previous state
    updatePage();

    //legend counter
    countLegends();
  }

  // EZA Filter functionality
    function initEZAFilters() {
      const showEzaOnly = document.getElementById('show-eza-only');
      const showEza2Only = document.getElementById('show-eza2-only');
      const showBothEza = document.getElementById('show-both-eza');
      const showNoEza = document.getElementById('show-no-eza');

      // Store original display values
      let originalDisplay = new Map();

      // Helper function to reset all filters
      function resetEZAFilters() {
        showEzaOnly.checked = false;
        showEza2Only.checked = false;
        showBothEza.checked = false;
        showNoEza.checked = false;

        // Restore original display values
        document.querySelectorAll('#special .flair').forEach(flair => {
          flair.style.display = originalDisplay.get(flair) || '';
        });

        countLegends();
      }

      // Helper function to save original state
      function saveOriginalDisplay() {
        document.querySelectorAll('#special .flair').forEach(flair => {
          originalDisplay.set(flair, flair.style.display);
        });
      }

      // Helper function to apply filter
      function applyEZAFilter(filterType) {
        // Save original state before first filter
        if (originalDisplay.size === 0) {
          saveOriginalDisplay();
        }

        // First, hide all non-disabled icons
        document.querySelectorAll('#special .flair').forEach(flair => {
          if (!flair.classList.contains('disabled')) {
            flair.style.display = 'none';
          }
        });

        // Then show only the filtered ones
        switch(filterType) {
          case 'eza':
            // Show EZA only = has .eza but NOT .eza2
            document.querySelectorAll('#special .flair.eza').forEach(flair => {
              if (!flair.classList.contains('disabled') && !flair.classList.contains('eza2')) {
                flair.style.display = '';
              }
            });
            break;
          case 'eza2':
            // Show Super EZA only = has .eza2
            document.querySelectorAll('#special .flair.eza2').forEach(flair => {
              if (!flair.classList.contains('disabled')) {
                flair.style.display = '';
              }
            });
            break;
          case 'both':
            // Show both = has either .eza OR .eza2
            document.querySelectorAll('#special .flair.eza, #special .flair.eza2').forEach(flair => {
              if (!flair.classList.contains('disabled')) {
                flair.style.display = '';
              }
            });
            break;
          case 'none':
            // Show non-EZA only = has neither .eza nor .eza2
            document.querySelectorAll('#special .flair').forEach(flair => {
              if (!flair.classList.contains('disabled') && !flair.classList.contains('eza') && !flair.classList.contains('eza2')) {
                flair.style.display = '';
              }
            });
            break;
        }

    countLegends();
  }

  // Event listeners for each toggle
  showEzaOnly.addEventListener('change', function() {
    if (this.checked) {
      // Uncheck other filters
      showEza2Only.checked = false;
      showBothEza.checked = false;
      showNoEza.checked = false;
      applyEZAFilter('eza');
    } else {
      resetEZAFilters();
    }
  });

  showEza2Only.addEventListener('change', function() {
    if (this.checked) {
      // Uncheck other filters
      showEzaOnly.checked = false;
      showBothEza.checked = false;
      showNoEza.checked = false;
      applyEZAFilter('eza2');
    } else {
      resetEZAFilters();
    }
  });

  showBothEza.addEventListener('change', function() {
    if (this.checked) {
      // Uncheck other filters
      showEzaOnly.checked = false;
      showEza2Only.checked = false;
      showNoEza.checked = false;
      applyEZAFilter('both');
    } else {
      resetEZAFilters();
    }
  });

  showNoEza.addEventListener('change', function() {
    if (this.checked) {
      // Uncheck other filters
      showEzaOnly.checked = false;
      showEza2Only.checked = false;
      showBothEza.checked = false;
      applyEZAFilter('none');
    } else {
      resetEZAFilters();
    }
  });
}

// Call this after coreFunctions()
initEZAFilters();

  //main function for selecting icons
  $("#special").on("click", "div", function(e) {
    const isChecked = document.getElementById('hide-lr').checked;

    const $obj = $(this);

    //hide LRs toggle
    if(isChecked){
      $obj.toggleClass("disabled");
      $obj.removeClass("selected");

      const save = $obj.hasClass("disabled");

      updateStorage($obj.attr("id"), "hidden", save);
      countLegends();
    }
    //if not checked
    else {
      //toggles selected classes
      $obj.toggleClass("selected");

      //creates object if selected class is present
      const save = $obj.hasClass("selected");

      //update the key
      updateStorage($obj.attr("id"), null, save);

      countLegends();
    }
  });

  document.getElementById('image-download')?.addEventListener('click', download);

  //select all button
  $("#select-all").on("click", function() {
    selectPage();
    countLegends();
  });

  //clear button
  $("#select-none").on("click", function() {
    if (confirm("Are you sure you want to reset the page? (This won't affect the other side of the checklist)")){
      resetPage();
      countLegends();
    }
  });

  //unhide specific legends
  $("#list-hidden").on("click", function() {
    listHidden();
    countLegends();
  });

  //generate image window
  $("#generate").on("click", function() {
    generateImage();
    countLegends();
  });

  //import code window
  $("#import").on("click", function() {
    toggleModal('import-modal');
  });

  //import code button
  $("#import-btn").on("click", function() {
    importSelection();
    countLegends();
  });

  //export code window
  $("#export").on("click", function() {
    toggleModal('export-modal');
    exportSelection();
  });

  //copy code button
  $("#copy-export").on("click", function() {
    copySelection();
  });
});
