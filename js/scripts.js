// Ensure button is loaded before adding event listener
document.addEventListener("DOMContentLoaded", () => {
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
  //CHECKLIST
  // 1. update total image numbers
  // 2. update EZA arrays if needed
  // 3. update changelog items
  loadFlairs = function() {
    let lrEZA = [
      1,2,3,4,5,6,7,8,9,
      10,11,12,13,14,15,16,17,18,19,
      20,21,22,23,24,25,26,27,28,29,
      30,31,32,33,34,35,36,37,38,
      40,41,42,43,44,45,46,47,48,49,
      50,51,52,53,54,55,56,57,58,59,
      60,61,62,63,64,65,66,67,68,69,
      71,72,73,74,75,76,
      80,82,83,85,86,87,88,89,
      91,93,94,95,96,97,98,
      116,
      136,
      149
    ]
    let lrEZA2 = [
      1, 6
    ]

    let dfEZA = [
      1,2,3,5,6,7,8,9,
      10,11,12,14,15,16,17,18,19,
      20,21,22,23,24,25,26,27,28,29,
      30,31,32,33,34,35,36,37,38,39,
      40,41,42,43,44,45,46,47,48,49,
      50,51,52,53,54,55,56,57,58,59,
      60,61,62,63,64,65,66,67,68,69,
      70,71,72,73,74,75,78,79,
      80,81,82,83,84,85,87,
      91,92,96,97,100
    ]
    let dfEZA2 = [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 18
    ]

    //LR changelog items
    const LRupdateItems = [
    "Icons re-organized based on true chronological order",
    "Added toggle to switch to DFE checklist",
    "INT Namek Goku EZA",
    "AGL Final Form Frieza EZA",
    "AGL Demon King Piccolo",
    "STR Kaioken Goku EZA",
    "TEQ Great Ape Vegeta EZA",
    "7th Anniversary LR EZAs"
    ]

    //DFE changelog items
    const DFEupdateItems = [
    "Added toggle to switch to LR checklist",
    "STR SSJ Goku/Gohan EZA",
    "AGL 1st Form Cell EZA",
    "AGL Pikkon EZA",
    "TEQ Janemba EZA"
    ]

     // Create icons dynamically
     // number format - LR : DFE
    let total = currentMode === "lr" ? 160 : 131
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
        const formattedDate = new Date(latestCommitDate).toLocaleDateString("en-GB", {
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

     domtoimage.toPng($('#icon-container')[0]).then(function (dataUrl) {
             const img = new Image();
             img.src = dataUrl;
             $(".modal-content").append(img);
     });
  }


  //download feature
  function download() {
    domtoimage.toBlob($('#icon-container')[0]).then(function (blob) {
          window.saveAs(blob, 'checklist.png');
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
