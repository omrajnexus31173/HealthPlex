import * as faceapi from '@vladmandic/face-api';
console.log('exports:', Object.keys(faceapi).slice(0, 20));
console.log('tf:', typeof faceapi.tf, faceapi.tf ? Object.keys(faceapi.tf).slice(0,15) : null);
