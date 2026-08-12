import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: "AIzaSyDhULbSEIiToweMSIa8gHR11HMkZtX6_MU",
    authDomain: "the-tertiary-structure.firebaseapp.com",
    projectId: "the-tertiary-structure",
    storageBucket: "the-tertiary-structure.firebasestorage.app",
    messagingSenderId: "1027887027314",
    appId: "1:1027887027314:web:29779d0e5b5cf050e79eeb",
    measurementId: "G-7822BNVRZQ"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// This matches your main app's database path!
export const appId = 'tertiary-v1';