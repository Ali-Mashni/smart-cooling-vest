# Deployment Guide (Firebase Hosting - Static Export)

This guide provides the exact steps to deploy your statically exported Next.js application to Firebase Hosting, ensuring it runs entirely within the free "Spark" plan.

## Prerequisites

1.  **Node.js and npm**: Ensure you have Node.js (which includes npm) installed on your machine.
2.  **Firebase CLI**: Install the Firebase command-line tools globally. If you don't have it, run:
    ```sh
    npm install -g firebase-tools
    ```

## Deployment Steps

Follow these steps in your project's root directory from your terminal.

### 1. Install Dependencies

If you haven't already, install the project's dependencies:

```sh
npm install
```

### 2. Build the Static Site

Run the build script. This will use Next.js's static export feature to generate a `out` directory containing your static application files.

```sh
npm run build
```

### 3. Log in to Firebase

Authenticate with your Google account to use the Firebase CLI. This will open a browser window for you to log in.

```sh
firebase login
```

### 4. Initialize Firebase Hosting

This one-time setup command configures your project for Firebase Hosting.

```sh
firebase init hosting
```

You will be asked a series of questions. Answer them as follows:

-   **? Which project would you like to use?** - Select the Firebase project you've been using for this app.
-   **? What do you want to use as your public directory?** - Enter `out`.
-   **? Configure as a single-page app (rewrite all urls to /index.html)?** - Enter `Yes`.
-   **? Set up automatic builds and deploys with GitHub?** - Enter `No`.
-   **? File out/index.html already exists. Overwrite?** - Enter `No`.

### 5. Deploy to Firebase Hosting

Finally, deploy your static site. The `--only hosting` flag ensures that only hosting content is deployed.

```sh
firebase deploy --only hosting
```

After the command finishes, it will provide you with your live **Hosting URL**. Your application is now deployed!

---

**Note**: As requested, this deployment process **does not use Firebase App Hosting**. It exclusively uses the classic Firebase Hosting for static files, which is fully compatible with the free Spark plan.
