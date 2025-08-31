#import "AVFoundationBarcodeScannerManager.h"
#import <AVFoundation/AVFoundation.h>
#import <React/RCTLog.h>

@interface AVFoundationBarcodeScannerManager () <AVCaptureMetadataOutputObjectsDelegate>

@property (nonatomic, strong) AVCaptureSession *captureSession;
@property (nonatomic, strong) AVCaptureDevice *captureDevice;
@property (nonatomic, strong) AVCaptureDeviceInput *captureDeviceInput;
@property (nonatomic, strong) AVCaptureMetadataOutput *captureMetadataOutput;
@property (nonatomic, strong) AVCaptureVideoPreviewLayer *capturePreviewLayer;

@property (nonatomic, assign) BOOL isScanning;
@property (nonatomic, assign) BOOL torchEnabled;

@end

@implementation AVFoundationBarcodeScannerManager

RCT_EXPORT_MODULE(AVFoundationBarcodeScanner);

+ (BOOL)requiresMainQueueSetup {
    return YES;
}

- (NSArray<NSString *> *)supportedEvents {
    return @[@"onBarcodeDetected", @"onCameraReady", @"onError"];
}

#pragma mark - React Native Methods

RCT_EXPORT_METHOD(initializeCamera:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
    dispatch_async(dispatch_get_main_queue(), ^{
        NSError *error;
        [self setupCaptureSession:&error];
        
        if (error) {
            reject(@"camera_setup_failed", error.localizedDescription, error);
        } else {
            resolve(@YES);
        }
    });
}

RCT_EXPORT_METHOD(startScanning:(RCTPromiseResolveBlock)resolve
                rejecter:(RCTPromiseRejectBlock)reject) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (self.captureSession && !self.captureSession.isRunning) {
            [self.captureSession startRunning];
            self.isScanning = YES;
            resolve(@YES);
        } else {
            reject(@"start_failed", @"Cannot start camera session", nil);
        }
    });
}

RCT_EXPORT_METHOD(stopScanning:(RCTPromiseResolveBlock)resolve
               rejecter:(RCTPromiseRejectBlock)reject) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (self.captureSession && self.captureSession.isRunning) {
            [self.captureSession stopRunning];
            self.isScanning = NO;
            resolve(@YES);
        } else {
            reject(@"stop_failed", @"Cannot stop camera session", nil);
        }
    });
}

RCT_EXPORT_METHOD(toggleTorch:(RCTPromiseResolveBlock)resolve
              rejecter:(RCTPromiseRejectBlock)reject) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (self.captureDevice && [self.captureDevice hasTorch]) {
            NSError *error;
            [self.captureDevice lockForConfiguration:&error];
            
            if (!error) {
                self.torchEnabled = !self.torchEnabled;
                self.captureDevice.torchMode = self.torchEnabled ? AVCaptureTorchModeOn : AVCaptureTorchModeOff;
                [self.captureDevice unlockForConfiguration];
                resolve(@(self.torchEnabled));
            } else {
                reject(@"torch_failed", error.localizedDescription, error);
            }
        } else {
            reject(@"torch_unavailable", @"Torch not available on this device", nil);
        }
    });
}

RCT_EXPORT_METHOD(switchCameraType:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    dispatch_async(dispatch_get_main_queue(), ^{
        AVCaptureDevicePosition currentPosition = self.captureDevice.position;
        AVCaptureDevicePosition newPosition = (currentPosition == AVCaptureDevicePositionBack) ? 
                                             AVCaptureDevicePositionFront : AVCaptureDevicePositionBack;
        
        AVCaptureDevice *newDevice = [self getDeviceForPosition:newPosition];
        if (newDevice) {
            NSError *error;
            AVCaptureDeviceInput *newInput = [AVCaptureDeviceInput deviceInputWithDevice:newDevice error:&error];
            
            if (!error) {
                [self.captureSession beginConfiguration];
                [self.captureSession removeInput:self.captureDeviceInput];
                
                if ([self.captureSession canAddInput:newInput]) {
                    [self.captureSession addInput:newInput];
                    self.captureDevice = newDevice;
                    self.captureDeviceInput = newInput;
                }
                
                [self.captureSession commitConfiguration];
                resolve(@YES);
            } else {
                reject(@"switch_failed", error.localizedDescription, error);
            }
        } else {
            reject(@"camera_unavailable", @"Camera not available", nil);
        }
    });
}

#pragma mark - Private Methods

- (void)setupCaptureSession:(NSError **)error {
    // Create capture session
    self.captureSession = [[AVCaptureSession alloc] init];
    self.captureSession.sessionPreset = AVCaptureSessionPresetHigh;
    
    // Get back camera device
    self.captureDevice = [self getDeviceForPosition:AVCaptureDevicePositionBack];
    
    if (!self.captureDevice) {
        *error = [NSError errorWithDomain:@"AVFoundationBarcodeScanner" 
                                     code:1001 
                                 userInfo:@{NSLocalizedDescriptionKey: @"No camera device available"}];
        return;
    }
    
    // Create device input
    self.captureDeviceInput = [AVCaptureDeviceInput deviceInputWithDevice:self.captureDevice error:error];
    
    if (*error || ![self.captureSession canAddInput:self.captureDeviceInput]) {
        return;
    }
    
    [self.captureSession addInput:self.captureDeviceInput];
    
    // Create metadata output for barcode detection
    self.captureMetadataOutput = [[AVCaptureMetadataOutput alloc] init];
    
    if (![self.captureSession canAddOutput:self.captureMetadataOutput]) {
        *error = [NSError errorWithDomain:@"AVFoundationBarcodeScanner" 
                                     code:1002 
                                 userInfo:@{NSLocalizedDescriptionKey: @"Cannot add metadata output"}];
        return;
    }
    
    [self.captureSession addOutput:self.captureMetadataOutput];
    
    // Set delegate for barcode detection
    dispatch_queue_t metadataQueue = dispatch_queue_create("metadata_queue", DISPATCH_QUEUE_SERIAL);
    [self.captureMetadataOutput setMetadataObjectsDelegate:self queue:metadataQueue];
    
    // Configure barcode types (EAN-13, EAN-8, UPC-A)
    NSMutableArray *barcodeTypes = [NSMutableArray array];
    
    if ([self.captureMetadataOutput.availableMetadataObjectTypes containsObject:AVMetadataObjectTypeEAN13Code]) {
        [barcodeTypes addObject:AVMetadataObjectTypeEAN13Code];
    }
    if ([self.captureMetadataOutput.availableMetadataObjectTypes containsObject:AVMetadataObjectTypeEAN8Code]) {
        [barcodeTypes addObject:AVMetadataObjectTypeEAN8Code];
    }
    if ([self.captureMetadataOutput.availableMetadataObjectTypes containsObject:AVMetadataObjectTypeUPCECode]) {
        [barcodeTypes addObject:AVMetadataObjectTypeUPCECode];
    }
    
    self.captureMetadataOutput.metadataObjectTypes = barcodeTypes;
    
    // Send camera ready event
    [self sendEventWithName:@"onCameraReady" body:@{@"success": @YES}];
}

- (AVCaptureDevice *)getDeviceForPosition:(AVCaptureDevicePosition)position {
    AVCaptureDeviceDiscoverySession *discoverySession = [AVCaptureDeviceDiscoverySession
                                                         discoverySessionWithDeviceTypes:@[AVCaptureDeviceTypeBuiltInWideAngleCamera]
                                                         mediaType:AVMediaTypeVideo
                                                         position:position];
    
    return discoverySession.devices.firstObject;
}

#pragma mark - AVCaptureMetadataOutputObjectsDelegate

- (void)captureOutput:(AVCaptureOutput *)output
didOutputMetadataObjects:(NSArray<__kindof AVMetadataObject *> *)metadataObjects
       fromConnection:(AVCaptureConnection *)connection {
    
    if (!self.isScanning) {
        return;
    }
    
    for (AVMetadataObject *metadata in metadataObjects) {
        if ([metadata isKindOfClass:[AVMetadataMachineReadableCodeObject class]]) {
            AVMetadataMachineReadableCodeObject *barcodeObject = (AVMetadataMachineReadableCodeObject *)metadata;
            
            NSString *barcodeType = [self convertAVMetadataTypeToString:barcodeObject.type];
            NSString *barcodeData = barcodeObject.stringValue;
            
            if (barcodeData && barcodeType) {
                // Send barcode event to React Native
                [self sendEventWithName:@"onBarcodeDetected" body:@{
                    @"type": barcodeType,
                    @"data": barcodeData
                }];
                
                RCTLogInfo(@"📱 iOS AVFoundation Barcode detected: %@ (%@)", barcodeData, barcodeType);
            }
        }
    }
}

- (NSString *)convertAVMetadataTypeToString:(AVMetadataObjectType)type {
    if ([type isEqualToString:AVMetadataObjectTypeEAN13Code]) {
        return @"ean13";
    } else if ([type isEqualToString:AVMetadataObjectTypeEAN8Code]) {
        return @"ean8";
    } else if ([type isEqualToString:AVMetadataObjectTypeUPCECode]) {
        return @"upc_a";
    }
    return nil;
}

#pragma mark - Cleanup

- (void)dealloc {
    if (self.captureSession) {
        [self.captureSession stopRunning];
    }
}

@end
