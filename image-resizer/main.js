const path = require("path");
const os = require('os');
const fs = require('fs');
const resizeImg = require('resize-img');
const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require("electron");

process.env.NODE_ENV = "production";

const isMac = process.platform === "darwin";
const isDev = process.env.NODE_ENV === "development"
let mainWindow;
let aboutWindow;

//create the main window
function createMainWindow() {
    mainWindow =  new BrowserWindow({
    title: 'Image Resizer',
    width:  800,
    height: 600,
    icon: `${__dirname}/assets/icons/Icon_256x256.png`,
    //resizable: isDev,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  // open dev tools if in dev mode
  if (!isDev) {
    mainWindow.webContents.openDevTools();
  }
  const isProd = app.isPackaged;
  if (!isProd) {
    mainWindow.loadFile(path.join(__dirname, './renderer/index.html'));
  } else {
    mainWindow.loadFile(path.join(process.resourcesPath, 'app.asar/renderer/index.html'));
  }
}

// app is ready
app.whenReady().then(() => {
    createMainWindow();
    // implememt menu
    const mainMenu = Menu.buildFromTemplate(menu);
    Menu.setApplicationMenu(mainMenu)
    app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
});

// About Window
function createAboutWindow() {
  aboutWindow = new BrowserWindow({
    width: 300,
    height: 300,
    title: 'About Image Resizer',
    icon: `${__dirname}/assets/icons/Icon_256x256.png`,
  });

   aboutWindow.loadFile(path.join(__dirname, './renderer/about.html'));
}

// Menu template
const menu = [
  ...(isMac
    ? [
        {
          label: app.name,
          submenu: [
            {
              label: 'About',
              click: createAboutWindow,
            },
          ],
        },
      ]
    : []),
  {
    role: 'fileMenu',
  },
  ...(!isMac
    ? [
        {
          label: 'Help',
          submenu: [
            {
              label: 'About',
              click: createAboutWindow,
            },
          ],
        },
      ]
    : []),
  // {
  //   label: 'File',
  //   submenu: [
  //     {
  //       label: 'Quit',
  //       click: () => app.quit(),
  //       accelerator: 'CmdOrCtrl+W',
  //     },
  //   ],
  // },
  ...(isDev
    ? [
        {
          label: 'Developer',
          submenu: [
            { role: 'reload' },
            { role: 'forcereload' },
            { type: 'separator' },
            { role: 'toggledevtools' },
          ],
        },
      ]
    : []),
];

// Respond to the resize image event
ipcMain.on('image:resize', (e, options) => {
  console.log(options);
  options.dest = path.join(os.homedir(), 'imageresizer');
  resizeImage(options);
});

// Resize and save image
async function resizeImage({ imgPath, height, width, dest }) {
  try {
    // console.log(imgPath, height, width, dest);

    // Resize image
    const newPath = await resizeImg(fs.readFileSync(imgPath), {
      width: +width,
      height: +height,
    });

    // Get filename
    const filename = path.basename(imgPath);

    // Create destination folder if it doesn't exist
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest);
    }

    // Write the file to the destination folder
    fs.writeFileSync(path.join(dest, filename), newPath);

    // Send success to renderer
    mainWindow.webContents.send('image:done');

    // Open the folder in the file explorer
    shell.openPath(dest);
  } catch (err) {
    console.log(err);
  }
}

ipcMain.handle('select-image', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: ['jpg', 'png', 'jpeg', 'gif'] }
    ]
  });

  if (result.canceled) return null;

  return result.filePaths[0];
});

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  if (!isMac) {
    app.quit()
  }
})