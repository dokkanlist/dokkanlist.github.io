// loads a count of icons in each folder from the pre-generated JSON file
let iconCounts = { lr: 172, dfe: 135 }; // Default fallback values - automatically updated by nodeJS

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
  $("#hide-lr").prop("checked", false);

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
    let lrEZA = parseRanges(`
      1-9, 10-19, 20-29, 30-38, 40-49, 50-59, 60-69, 70-76,78-80,
      82-89, 90-91, 93-98, 101-102, 104, 116, 136, 149
    `);
    let lrEZA2 = parseRanges('1,6-8,12,54');

    let dfEZA = parseRanges(`
      1-3, 5-9, 10-12, 14-19, 20-29, 30-39, 40-49, 50-59,
      60-69, 70-75, 77-79, 80-85, 87-88, 91-93, 96-97, 100, 104
    `);
    let dfEZA2 = parseRanges('1-11, 13, 14, 15, 17-20, 25-26');

    //LR changelog items
    const LRupdateItems = [
      "INT GT SSJ Gohan/Goten",
      "STR Chichi"
    ]

    //DFE changelog items
    const DFEupdateItems = [
    "TEQ SSJ4 Daima Goku"
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
      // Get the current mode from localStorage
      const currentMode = localStorage.getItem("dokkanMode");

      // Iterate through localStorage and remove only relevant keys
      Object.keys(localStorage).forEach(key => {
          if ((currentMode === "lr" && !key.endsWith("b")) || (currentMode === "dfe" && key.endsWith("b"))) {
              localStorage.removeItem(key);
              $("#" + key).removeClass("selected disabled");
          }
      });
  }

  //total legend tracker
  function countLegends() {
    let rarity = currentMode === "lr" ? "LRs" : "DFEs";
    const amount = $(".selected").length;
    const total = $("#special .flair").length;
    const disabled = $('.disabled').length;

    $('#counter').html("<span class='cl'>Total "+rarity+" - </span>" + amount + "/" + (total-disabled));
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

  //export image function
  function generateImage() {
    toggleModal('image-modal');
    $(".modal-content").empty();

    const node = document.getElementById('icon-container');

    htmlToImage.toPng(node, {
      pixelRatio: 3, // Increase for sharper output (e.g., 2x or 3x)
      skipFonts: true,
      skipAutoScale: false,
      style: {
        transform: 'scale(1)', // Prevent distortion
        transformOrigin: 'top left'
      }
    })
    .then(function (dataUrl) {
      const img = new Image();
      img.src = dataUrl;
      img.style.width = node.offsetWidth + "px"; // Display at natural size
      img.style.height = node.offsetHeight + "px";
      $(".modal-content").append(img);
    })
    .catch(function (error) {
      console.error('Image generation failed:', error);
    });
  }

  //download feature
  function download() {
    const node = document.getElementById('icon-container');

    htmlToImage.toBlob(node, {
      pixelRatio: 3, // Higher = sharper image
      skipFonts: true,
      filter: (node) => {
        // Avoid extension styles and cross-origin errors
        return !(node.tagName === 'LINK' && node.href && node.href.startsWith('moz-extension://'));
      }
    })
    .then(function (blob) {
      if (blob) {
        window.saveAs(blob, 'checklist.png');
      } else {
        console.error("Image blob generation failed.");
      }
    })
    .catch(function (error) {
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
