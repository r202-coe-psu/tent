pipeline {
    agent { label 'mgmt' }

    stages {
        stage('Deploy to Staging Server') {
            when {
                branch 'staging'
            }
            steps {
                withCredentials([
                    sshUserPrivateKey(credentialsId: 'tent-staging-ssh', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER'),
                    string(credentialsId: 'tent-staging-host', variable: 'SSH_HOST'),
                    string(credentialsId: 'tent-staging-port', variable: 'SSH_PORT')
                ]) {
                    sh '''
                        echo "Starting deployment to Staging server..."
                        
                        ssh -i $SSH_KEY -p $SSH_PORT -o StrictHostKeyChecking=no $SSH_USER@$SSH_HOST "
                            
                            echo '==> Deploying Tent to Staging...'
                            cd /home/projects/tent
                            git -C /home/projects/tent pull
                            docker compose -f docker-compose.staging.no-nginx.yml up -d --build --force-recreate
                        "
                        echo "Deployment process finished successfully!"
                    '''
                }
            }
        }

        stage('Deploy to Production') {
            when {
                branch 'main'
            }
            steps {
                withCredentials([
                    sshUserPrivateKey(credentialsId: 'tent-prod-ssh', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER'),
                    string(credentialsId: 'tent-prod-host', variable: 'SSH_HOST'),
                    string(credentialsId: 'tent-prod-port', variable: 'SSH_PORT')
                ]) {
                    sh '''
                        echo "Starting deployment to Production server..."
                        
                        ssh -i $SSH_KEY -p $SSH_PORT -o StrictHostKeyChecking=no $SSH_USER@$SSH_HOST "
                            
                            # [1] Deploy Tent (Web & API & CouchDB)
                            echo '==> Deploying Tent...'
                            ssh -o StrictHostKeyChecking=no -i ~/.ssh/id_ed25519_r202cid $SSH_USER@r202-tent '
                                cd /home/projects/tent
                                git -C /home/projects/tent pull
                                docker compose -f docker-compose.production.no-nginx.yml up -d --build --force-recreate
                                '
                        "
                        echo "Deployment process finished successfully!"
                    '''
                }
            }
        }
    }

    post {
        always {
            cleanWs(cleanWhenNotBuilt: false,
                    deleteDirs: true,
                    disableDeferredWipeout: true,
                    notFailBuild: true)
        }
    }
}
