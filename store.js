// store.js

export const state = {
    // Database Data
    currentUser: null,
    clientsData: [],
    premisesData: [],
    allReportsData: [],
    
    // UI State
    currentMapStyle: null, // Will be set on init
    currentGalleryImages: [],
    currentGalleryIndex: 0,
    currentViewedPremise: null,
    
    // Filter State
    activeAdminTab: 'clients',
    currentAdminSubFilter: 'all',
    
    // Modal State
    currentEditReportId: null,
    currentEditJobNo: null,
    
    // Global Map Instance
    mapInstance: null
};